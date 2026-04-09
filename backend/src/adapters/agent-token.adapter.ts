import { and, eq } from 'drizzle-orm';

import { auth } from '../lib/betterauth/auth.instance';
import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';

export interface AgentTokenRecord {
  id: string;
  name: string | null;
  start: string;
  createdAt: string;
  lastUsedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CreateAgentTokenResult {
  id: string;
  key: string;
  name: string | null;
  createdAt: string;
}

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }

    return null;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

export interface AgentTokenStore {
  create(userId: string, params: { name: string; agentId: string }): Promise<CreateAgentTokenResult>;
  list(userId: string): Promise<AgentTokenRecord[]>;
  revoke(userId: string, tokenId: string): Promise<void>;
}

/**
 * AgentTokenAdapter
 *
 * Uses Better Auth's server-side API for key creation (no session required)
 * and direct Drizzle queries for listing and revoking keys.
 */
export class AgentTokenAdapter implements AgentTokenStore {
  async create(userId: string, params: { name: string; agentId: string }): Promise<CreateAgentTokenResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createApiKey = (auth.api as any).createApiKey as (opts: { body: Record<string, unknown> }) => Promise<Record<string, unknown>>;
    const result = await createApiKey({
      body: {
        userId,
        name: params.name,
        metadata: { agentId: params.agentId },
      },
    });

    if (typeof result.id !== 'string' || typeof result.key !== 'string') {
      throw new Error('Failed to create API key');
    }

    return {
      id: result.id,
      key: result.key,
      name: typeof result.name === 'string' || result.name === null ? result.name : null,
      createdAt: result.createdAt instanceof Date ? result.createdAt.toISOString() : String(result.createdAt),
    };
  }

  async list(userId: string): Promise<AgentTokenRecord[]> {
    const rows = await db
      .select()
      .from(schema.apikeys)
      .where(
        and(
          eq(schema.apikeys.userId, userId),
          eq(schema.apikeys.enabled, true),
        ),
      );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      start: row.start ?? '',
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastRequest?.toISOString() ?? null,
      metadata: parseMetadata(row.metadata),
    }));
  }

  async revoke(userId: string, tokenId: string): Promise<void> {
    const result = await db
      .delete(schema.apikeys)
      .where(
        and(
          eq(schema.apikeys.id, tokenId),
          eq(schema.apikeys.userId, userId),
        ),
      )
      .returning({ id: schema.apikeys.id });

    if (result.length === 0) {
      throw new Error('Token not found');
    }
  }
}

export const agentTokenAdapter = new AgentTokenAdapter();
