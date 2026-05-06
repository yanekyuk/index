import { and, eq, isNull } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import * as schema from '../schemas/database.schema';
import { ensurePersonalNetwork } from '../adapters/database.adapter';
import { agentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { agentTokenAdapter } from '../adapters/agent-token.adapter';

const logger = log.service.from('experiment');

export interface ExperimentSignupResult {
  user: { id: string; email: string };
  apiKey: string;
  agentId: string;
  /** Ready-to-run command to configure a self-hosted OpenClaw plugin. */
  connectCommand: string;
  created: boolean;
}

class ExperimentService {
  async signup(networkId: string, email: string): Promise<ExperimentSignupResult> {
    const normalizedEmail = email.toLowerCase().trim();
    logger.verbose('[ExperimentService] Signup attempt', { networkId, email: normalizedEmail });

    const { user, created } = await this.findOrCreateUser(normalizedEmail, networkId);
    await ensurePersonalNetwork(user.id);
    await this.joinExperimentNetwork(user.id, networkId);
    const { apiKey, agentId } = await this.ensureAgentAndCreateToken(user.id);

    logger.info('[ExperimentService] Signup complete', {
      userId: user.id,
      networkId,
      created,
    });

    return {
      user: { id: user.id, email: user.email },
      apiKey,
      agentId,
      connectCommand: this.buildConnectCommand(apiKey),
      created,
    };
  }

  private async findOrCreateUser(
    email: string,
    experimentNetworkId: string,
  ): Promise<{ user: { id: string; email: string }; created: boolean }> {
    const [existing] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(and(
        eq(schema.users.email, email),
        eq(schema.users.experimentNetworkId, experimentNetworkId),
        isNull(schema.users.deletedAt),
      ))
      .limit(1);

    if (existing) {
      return { user: existing, created: false };
    }

    const [newUser] = await db
      .insert(schema.users)
      .values({
        email,
        name: email.split('@')[0],
        emailVerified: true,
        isGhost: false,
        experimentNetworkId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.users.id, email: schema.users.email });

    if (!newUser) {
      const [raced] = await db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(and(
          eq(schema.users.email, email),
          eq(schema.users.experimentNetworkId, experimentNetworkId),
          isNull(schema.users.deletedAt),
        ))
        .limit(1);

      if (!raced) throw new Error('Failed to create experiment user');
      return { user: raced, created: false };
    }

    return { user: newUser, created: true };
  }

  private async joinExperimentNetwork(userId: string, networkId: string): Promise<void> {
    await db
      .insert(schema.networkMembers)
      .values({
        networkId,
        userId,
        permissions: ['member'],
      })
      .onConflictDoNothing();
  }

  private async ensureAgentAndCreateToken(userId: string): Promise<{ agentId: string; apiKey: string }> {
    const existingAgents = await db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(and(
        eq(schema.agents.ownerId, userId),
        eq(schema.agents.type, 'personal'),
        isNull(schema.agents.deletedAt),
      ))
      .limit(1);

    let agentId: string;

    if (existingAgents.length > 0) {
      agentId = existingAgents[0].id;
    } else {
      const agent = await agentDatabaseAdapter.createAgent({
        ownerId: userId,
        name: 'Personal Agent',
        type: 'personal',
      });

      await agentDatabaseAdapter.grantPermission({
        agentId: agent.id,
        userId,
        scope: 'global',
        actions: [
          'manage:profile',
          'manage:intents',
          'manage:networks',
          'manage:contacts',
          'manage:opportunities',
        ],
      });

      agentId = agent.id;
    }

    const token = await agentTokenAdapter.create(userId, {
      name: 'Personal Agent API Key',
      agentId,
    });

    return { agentId, apiKey: token.key };
  }

  private buildConnectCommand(apiKey: string): string {
    const baseUrl = (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/+$/, '');
    const urlFlag =
      baseUrl && baseUrl !== 'https://index.network'
        ? ` --url ${baseUrl}`
        : '';
    return `openclaw index connect --api-key ${apiKey}${urlFlag}`;
  }
}

export const experimentService = new ExperimentService();
