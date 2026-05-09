import { and, eq } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { buildMcpServerConfig } from '../lib/mcp/mcp-config';
import * as schema from '../schemas/database.schema';

/**
 * Experiment is a thin facade over the network-invitation flow: signup uses
 * the master-key headless path and importMembers iterates rows. Both delegate
 * user/agent provisioning to {@link networkInvitationService}. This is a
 * deliberate, narrowly-scoped service-to-service import — the layering rule
 * normally forbids it, but introducing events/queues here would be over-
 * engineering. Tracked for follow-up: experiment.service is expected to be
 * folded into network-invitation.service entirely.
 */
// eslint-disable-next-line boundaries/dependencies
import { networkInvitationService } from './network-invitation.service';

const logger = log.service.from('experiment');

export interface ImportRow {
  email: string;
  name?: string;
  bio?: string;
  location?: string;
  socials: { label: string; value: string }[];
}

export interface SignupPayload {
  email: string;
  name?: string;
  bio?: string;
  location?: string;
  socials?: { label: string; value: string }[];
}

export interface ExperimentSignupResult {
  user: { id: string; email: string };
  apiKey: string;
  mcpServer: {
    name: string;
    url: string;
    headers: Record<string, string>;
  };
  created: boolean;
}

class ExperimentService {
  async signup(networkId: string, payload: SignupPayload): Promise<ExperimentSignupResult> {
    const normalizedEmail = payload.email.toLowerCase().trim();
    logger.verbose('[ExperimentService] Signup attempt', { networkId, email: normalizedEmail });

    const result = await networkInvitationService.ensureMembership({
      networkId,
      email: normalizedEmail,
      name: payload.name,
      rotateKey: true,
    });

    // rotateKey=true guarantees apiKey is non-null
    const apiKey = result.apiKey!;

    if (payload.name || payload.bio || payload.location || (payload.socials && payload.socials.length > 0)) {
      await this.applyProfilePatch(result.user.id, {
        email: normalizedEmail,
        name: payload.name,
        bio: payload.bio,
        location: payload.location,
        socials: payload.socials ?? [],
      });
    }

    logger.info('[ExperimentService] Signup complete', {
      userId: result.user.id,
      networkId,
      created: result.created,
    });

    return {
      user: result.user,
      apiKey,
      mcpServer: buildMcpServerConfig(apiKey),
      created: result.created,
    };
  }

  async importMembers(networkId: string, rows: ImportRow[]): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const email = row.email.toLowerCase().trim();
        const result = await networkInvitationService.invite({ networkId, email, name: row.name });
        await this.applyProfilePatch(result.user.id, row);
        imported++;
      } catch (err) {
        logger.warn('[ExperimentService] Import row failed', { email: row.email, error: err });
        skipped++;
      }
    }

    logger.info('[ExperimentService] Import complete', { networkId, imported, skipped });
    return { imported, skipped };
  }

  /**
   * Applies the optional profile/socials patch for an imported member onto an
   * existing user row. Idempotent — safe to call repeatedly.
   *
   * @param userId - User to patch.
   * @param row - Import row carrying optional name/bio/location/socials.
   */
  private async applyProfilePatch(userId: string, row: ImportRow): Promise<void> {
    if (row.name) {
      await db
        .update(schema.users)
        .set({ name: row.name })
        .where(eq(schema.users.id, userId));
    }

    if (row.bio || row.location) {
      const [existing] = await db
        .select({ id: schema.userProfiles.id, identity: schema.userProfiles.identity })
        .from(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, userId))
        .limit(1);

      const patch: { bio?: string; location?: string } = {};
      if (row.bio) patch.bio = row.bio;
      if (row.location) patch.location = row.location;

      if (existing) {
        const identity = (existing.identity as { name?: string; bio?: string; location?: string } | null) ?? {};
        await db
          .update(schema.userProfiles)
          .set({ identity: { name: identity.name ?? '', bio: identity.bio ?? '', location: identity.location ?? '', ...patch }, updatedAt: new Date() })
          .where(eq(schema.userProfiles.id, existing.id));
      } else {
        await db
          .insert(schema.userProfiles)
          .values({
            userId,
            identity: {
              name: row.name || '',
              bio: row.bio || '',
              location: row.location || '',
            },
          });
      }
    }

    for (const social of row.socials) {
      const [existing] = await db
        .select({ id: schema.userSocials.id })
        .from(schema.userSocials)
        .where(and(
          eq(schema.userSocials.userId, userId),
          eq(schema.userSocials.label, social.label),
        ))
        .limit(1);

      if (existing) {
        await db
          .update(schema.userSocials)
          .set({ value: social.value })
          .where(eq(schema.userSocials.id, existing.id));
      } else {
        await db
          .insert(schema.userSocials)
          .values({ userId, label: social.label, value: social.value });
      }
    }
  }

}

export const experimentService = new ExperimentService();
