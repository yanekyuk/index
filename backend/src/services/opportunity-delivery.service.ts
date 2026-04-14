/**
 * OpportunityDeliveryService
 *
 * Manages reservation and committed delivery of opportunities to agent channels.
 * Implements a two-phase pickup → confirm pattern backed by the `opportunity_deliveries` ledger.
 *
 * Reservation flow:
 *   1. `pickupPending` — finds an eligible pending opportunity, writes a reservation row,
 *      and returns the rendered card plus a one-time reservation token.
 *   2. `confirmDelivered` — marks the reservation as committed (sets `delivered_at`).
 *      The partial unique index `uniq_opp_deliveries_committed` then prevents a second
 *      committed row for the same (user, opportunity, channel, deliveredAtStatus) tuple.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  OpportunityPresenter,
  canUserSeeOpportunity,
  gatherPresenterContext,
  type PresenterDatabase,
} from '@indexnetwork/protocol';

import { chatDatabaseAdapter } from '../adapters/database.adapter';
import db from '../lib/drizzle/drizzle';
import { agents, opportunities, opportunityDeliveries } from '../schemas/database.schema';

const RESERVATION_TTL_SECONDS = 60;
const CHANNEL = 'openclaw';
const TRIGGER_PENDING = 'pending_pickup';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderedCard {
  headline: string;
  personalizedSummary: string;
  suggestedAction: string;
  narratorRemark: string;
}

export interface PickupPendingResult {
  opportunityId: string;
  reservationToken: string;
  reservationExpiresAt: Date;
  rendered: RenderedCard;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core service for reserving and committing opportunity deliveries via the
 * `opportunity_deliveries` ledger. One instance is safe to share across requests.
 */
export class OpportunityDeliveryService {
  private readonly presenterDb: PresenterDatabase;

  constructor(
    private readonly presenter: OpportunityPresenter = new OpportunityPresenter(),
    presenterDb?: PresenterDatabase,
  ) {
    this.presenterDb = presenterDb ?? (chatDatabaseAdapter as unknown as PresenterDatabase);
  }

  /**
   * Find the next pending opportunity for the agent owner and reserve it.
   *
   * Returns `null` when no eligible opportunity is available.
   *
   * @param agentId - The agent making the pickup request (must have an owner).
   */
  async pickupPending(agentId: string): Promise<PickupPendingResult | null> {
    const userId = await this.resolveAgentOwner(agentId);
    const ttlCutoff = new Date(Date.now() - RESERVATION_TTL_SECONDS * 1000);

    // Fetch candidate opportunities where:
    //  - status = 'pending'
    //  - user appears in actors JSONB array
    //  - no committed delivery row (delivered_at IS NOT NULL) exists for this (user, opp, channel, status)
    //  - no live reservation exists (reserved_at within TTL window, delivered_at IS NULL)
    // We limit to 20 and filter with canUserSeeOpportunity in JS to stay consistent with protocol rules.
    const result = await db.execute(sql`
      SELECT o.id, o.actors, o.status, o.interpretation
      FROM opportunities o
      WHERE o.status = 'pending'
        AND o.actors::jsonb @> ${JSON.stringify([{ userId }])}::jsonb
        AND NOT EXISTS (
          SELECT 1 FROM opportunity_deliveries d
          WHERE d.opportunity_id = o.id
            AND d.user_id = ${userId}
            AND d.channel = ${CHANNEL}
            AND d.delivered_at_status = 'pending'
            AND (
              d.delivered_at IS NOT NULL
              OR (d.reserved_at IS NOT NULL AND d.reserved_at >= ${ttlCutoff.toISOString()})
            )
        )
      ORDER BY o.updated_at ASC
      LIMIT 20
    `);

    const rows = result as unknown as Array<{ id: string; actors: unknown; status: string; interpretation: unknown }>;

    // Filter in JS via canUserSeeOpportunity (consistent with maintenance.graph.ts pattern)
    const visible = rows.filter((row: { id: string; actors: unknown; status: string }) => {
      const actors = row.actors as Array<{ userId: string; role: string }>;
      return canUserSeeOpportunity(actors, row.status, userId);
    });

    const chosen = visible[0];
    if (!chosen) return null;

    const reservationToken = randomUUID();
    const reservedAt = new Date();

    // Insert reservation row. The uniqueIndex is partial (WHERE delivered_at IS NOT NULL),
    // so multiple reservation rows can co-exist — only the first confirmDelivered wins.
    await db.insert(opportunityDeliveries).values({
      opportunityId: chosen.id,
      userId,
      agentId,
      channel: CHANNEL,
      trigger: TRIGGER_PENDING,
      deliveredAtStatus: 'pending',
      reservationToken,
      reservedAt,
    });

    const rendered = await this.renderOpportunityCard(chosen.id, userId);

    return {
      opportunityId: chosen.id,
      reservationToken,
      reservationExpiresAt: new Date(reservedAt.getTime() + RESERVATION_TTL_SECONDS * 1000),
      rendered,
    };
  }

  /**
   * Commit an earlier reservation as delivered.
   *
   * The partial unique index `uniq_opp_deliveries_committed` prevents a second committed row
   * for the same (user, opportunity, channel, deliveredAtStatus) tuple, so duplicate
   * confirms (e.g. two agents racing) will fail at the DB level.
   *
   * @param opportunityId - The opportunity that was delivered.
   * @param userId - The user the opportunity was delivered to.
   * @param reservationToken - The one-time token issued at pickup time.
   * @throws Error when the token is invalid or the row is already committed.
   */
  async confirmDelivered(
    opportunityId: string,
    userId: string,
    reservationToken: string,
  ): Promise<void> {
    const rows = await db
      .update(opportunityDeliveries)
      .set({ deliveredAt: new Date() })
      .where(
        and(
          eq(opportunityDeliveries.opportunityId, opportunityId),
          eq(opportunityDeliveries.userId, userId),
          eq(opportunityDeliveries.reservationToken, reservationToken),
          isNull(opportunityDeliveries.deliveredAt),
        ),
      )
      .returning({ id: opportunityDeliveries.id });

    if (rows.length === 0) {
      throw new Error('invalid_reservation_token_or_already_delivered');
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Resolve the owner user ID of an agent.
   *
   * @param agentId - Agent to look up.
   * @throws Error when the agent does not exist.
   */
  private async resolveAgentOwner(agentId: string): Promise<string> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) throw new Error('agent_not_found');
    return agent.ownerId;
  }

  /**
   * Load the opportunity and invoke the presenter to produce a user-facing card.
   * Falls back to raw reasoning text when the LLM call fails.
   *
   * @param opportunityId - The opportunity to render.
   * @param userId - The user the card is being rendered for (determines role context).
   */
  private async renderOpportunityCard(
    opportunityId: string,
    userId: string,
  ): Promise<RenderedCard> {
    const [opp] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId));

    if (!opp) throw new Error('opportunity_not_found');

    try {
      const presenterInput = await gatherPresenterContext(
        this.presenterDb,
        opp as unknown as Parameters<typeof gatherPresenterContext>[1],
        userId,
      );
      presenterInput.opportunityStatus = 'pending';

      const presented = await this.presenter.presentHomeCard(presenterInput);
      return {
        headline: presented.headline,
        personalizedSummary: presented.personalizedSummary,
        suggestedAction: presented.suggestedAction,
        narratorRemark: presented.narratorRemark,
      };
    } catch {
      // LLM fallback — follow opportunity.service.ts:getChatContext fallback shape
      const rawReasoning =
        (opp.interpretation as { reasoning?: string } | null)?.reasoning ?? '';
      return {
        headline: rawReasoning.substring(0, 80) || 'Connection opportunity',
        personalizedSummary: rawReasoning,
        suggestedAction: 'Open Index Network to see the full context and decide.',
        narratorRemark: '',
      };
    }
  }
}
