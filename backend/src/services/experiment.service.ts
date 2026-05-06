import { and, eq, isNull } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import * as schema from '../schemas/database.schema';
import { ensurePersonalNetwork } from '../adapters/database.adapter';
import { agentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { agentTokenAdapter } from '../adapters/agent-token.adapter';

const logger = log.service.from('experiment');

export interface ImportRow {
  email: string;
  name?: string;
  bio?: string;
  location?: string;
  socials: { label: string; value: string }[];
}

export interface ExperimentSignupResult {
  user: { id: string; email: string };
  apiKey: string;
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
    const apiKey = await this.ensureAgentAndCreateToken(user.id);

    logger.info('[ExperimentService] Signup complete', {
      userId: user.id,
      networkId,
      created,
    });

    return {
      user: { id: user.id, email: user.email },
      apiKey,
      connectCommand: this.buildConnectCommand(apiKey),
      created,
    };
  }

  async importMembers(networkId: string, rows: ImportRow[]): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const { user } = await this.findOrCreateUser(row.email.toLowerCase().trim(), networkId);
        await ensurePersonalNetwork(user.id);
        await this.joinExperimentNetwork(user.id, networkId);

        if (row.name) {
          await db
            .update(schema.users)
            .set({ name: row.name })
            .where(eq(schema.users.id, user.id));
        }

        if (row.bio || row.location) {
          const [existing] = await db
            .select({ id: schema.userProfiles.id, identity: schema.userProfiles.identity })
            .from(schema.userProfiles)
            .where(eq(schema.userProfiles.userId, user.id))
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
                userId: user.id,
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
              eq(schema.userSocials.userId, user.id),
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
              .values({ userId: user.id, label: social.label, value: social.value });
          }
        }

        imported++;
      } catch (err) {
        logger.warn('[ExperimentService] Import row failed', { email: row.email, error: err });
        skipped++;
      }
    }

    logger.info('[ExperimentService] Import complete', { networkId, imported, skipped });
    return { imported, skipped };
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
        autoAssign: true,
      })
      .onConflictDoNothing();
  }

  private async ensureAgentAndCreateToken(userId: string): Promise<string> {
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

    return token.key;
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
