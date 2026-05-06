import { and, eq, isNull } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import * as schema from '../schemas/database.schema';
import { agentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { agentTokenAdapter } from '../adapters/agent-token.adapter';
import { ensurePersonalNetwork } from '../adapters/database.adapter';

const logger = log.service.from('network-invitation');

export interface InviteParams {
  networkId: string;
  email: string;
  /** Optional name applied only to the new user. Ignored if user already exists. */
  name?: string;
}

export interface InviteResult {
  user: { id: string; email: string };
  /** Raw API key; only present when a new agent was provisioned. Null when reusing an existing user. */
  apiKey: string | null;
  /** True if the user was newly created. */
  created: boolean;
  /** True if the agent + permissions + key were created in this call. */
  agentProvisioned: boolean;
}

export const SCOPED_INVITED_AGENT_ACTIONS = [
  'manage:profile',
  'manage:intents',
  'manage:networks',
  'manage:contacts',
  'manage:opportunities',
] as const;

class NetworkInvitationService {
  /**
   * Idempotent invite. Ensures user, personal network, and network membership
   * always exist; for newly-created users only, also provisions a network-
   * scoped personal agent and an API key. Returns the raw key once on first
   * creation; subsequent invites for the same user return null.
   *
   * @param params - networkId, email, optional name
   * @returns InviteResult — see field docs
   */
  async invite(params: InviteParams): Promise<InviteResult> {
    const email = params.email.toLowerCase().trim();
    const { user, created } = await this.findOrCreateUser(email, params.name);

    await ensurePersonalNetwork(user.id);
    await this.joinNetwork(user.id, params.networkId);

    if (!created) {
      logger.info('[NetworkInvitation] Reusing existing user', { userId: user.id, networkId: params.networkId });
      return { user, apiKey: null, created: false, agentProvisioned: false };
    }

    const apiKey = await this.provisionScopedAgent(user.id, params.networkId);
    logger.info('[NetworkInvitation] Provisioned scoped agent', { userId: user.id, networkId: params.networkId });
    return { user, apiKey, created: true, agentProvisioned: true };
  }

  private async findOrCreateUser(
    email: string,
    name?: string,
  ): Promise<{ user: { id: string; email: string }; created: boolean }> {
    const [existing] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.email, email),
          isNull(schema.users.deletedAt),
          isNull(schema.users.experimentNetworkId),
        ),
      )
      .limit(1);

    if (existing) return { user: existing, created: false };

    const [newUser] = await db
      .insert(schema.users)
      .values({
        email,
        name: name ?? email.split('@')[0],
        emailVerified: true,
        isGhost: false,
      })
      .onConflictDoNothing()
      .returning({ id: schema.users.id, email: schema.users.email });

    if (!newUser) {
      const [raced] = await db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.email, email),
            isNull(schema.users.deletedAt),
            isNull(schema.users.experimentNetworkId),
          ),
        )
        .limit(1);
      if (!raced) {
        throw new Error(
          `Cannot invite user: email exists but is filtered out (likely soft-deleted or experiment-scoped): ${email}`,
        );
      }
      return { user: raced, created: false };
    }
    return { user: newUser, created: true };
  }

  private async joinNetwork(userId: string, networkId: string): Promise<void> {
    await db
      .insert(schema.networkMembers)
      .values({ networkId, userId, permissions: ['member'], autoAssign: true })
      .onConflictDoNothing();
  }

  private async provisionScopedAgent(userId: string, networkId: string): Promise<string> {
    const agent = await agentDatabaseAdapter.createAgent({
      ownerId: userId,
      name: 'Personal Agent',
      type: 'personal',
    });
    await agentDatabaseAdapter.grantPermission({
      agentId: agent.id,
      userId,
      scope: 'network',
      scopeId: networkId,
      actions: [...SCOPED_INVITED_AGENT_ACTIONS],
    });
    const token = await agentTokenAdapter.create(userId, {
      name: 'Personal Agent API Key',
      agentId: agent.id,
    });
    return token.key;
  }
}

export const networkInvitationService = new NetworkInvitationService();
