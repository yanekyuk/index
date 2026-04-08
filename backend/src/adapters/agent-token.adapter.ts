import { auth } from '../lib/betterauth/auth.instance';
import { BASE_URL } from '../lib/betterauth/betterauth';

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

type CreateApiKeyResponse = {
  id?: unknown;
  key?: unknown;
  name?: unknown;
  createdAt?: unknown;
};

type ListApiKeyResponse = {
  apiKeys?: unknown;
};

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

function asTokenRecord(value: unknown): AgentTokenRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.createdAt !== 'string') {
    return null;
  }

  return {
    id: row.id,
    name: typeof row.name === 'string' || row.name === null ? row.name : null,
    start: typeof row.start === 'string' ? row.start : '',
    createdAt: row.createdAt,
    lastUsedAt: typeof row.lastUsedAt === 'string' || row.lastUsedAt === null ? row.lastUsedAt : null,
    metadata: parseMetadata(row.metadata),
  };
}

export interface AgentTokenStore {
  create(headers: Headers, params: { name: string; agentId: string }): Promise<CreateAgentTokenResult>;
  list(headers: Headers): Promise<AgentTokenRecord[]>;
  revoke(headers: Headers, tokenId: string): Promise<void>;
}

async function callAuthJson<T>(path: string, init: { method: 'GET' | 'POST'; headers: Headers; body?: unknown }): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const request = new Request(`${BASE_URL}/api/auth${path}`, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const response = await auth.handler(request);
  if (!response.ok) {
    let message = `Auth request failed with status ${response.status}`;
    try {
      const payload = await response.json() as { error?: unknown; message?: unknown };
      if (typeof payload.error === 'string') {
        message = payload.error;
      } else if (typeof payload.message === 'string') {
        message = payload.message;
      }
    } catch {
      // Keep default message when the response body is empty or not JSON.
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

/**
 * AgentTokenAdapter
 *
 * Wraps Better Auth's API key programmatic APIs for agent-linked token
 * creation and revocation.
 */
export class AgentTokenAdapter implements AgentTokenStore {
  async create(headers: Headers, params: { name: string; agentId: string }): Promise<CreateAgentTokenResult> {
    const result = await callAuthJson<CreateApiKeyResponse>('/api-key/create', {
      method: 'POST',
      headers,
      body: {
        name: params.name,
        metadata: { agentId: params.agentId },
      },
    });

    if (typeof result.id !== 'string' || typeof result.key !== 'string' || typeof result.createdAt !== 'string') {
      throw new Error('Failed to create API key');
    }

    return {
      id: result.id,
      key: result.key,
      name: typeof result.name === 'string' || result.name === null ? result.name : null,
      createdAt: result.createdAt,
    };
  }

  async list(headers: Headers): Promise<AgentTokenRecord[]> {
    const result = await callAuthJson<ListApiKeyResponse | unknown[]>('/api-key/list', {
      method: 'GET',
      headers,
    });

    const rows = Array.isArray(result)
      ? result
      : result && typeof result === 'object' && Array.isArray((result as ListApiKeyResponse).apiKeys)
        ? (result as ListApiKeyResponse).apiKeys as unknown[]
        : [];

    return rows.map(asTokenRecord).filter((row): row is AgentTokenRecord => row !== null);
  }

  async revoke(headers: Headers, tokenId: string): Promise<void> {
    await callAuthJson('/api-key/delete', {
      method: 'POST',
      headers,
      body: { keyId: tokenId },
    });
  }
}

export const agentTokenAdapter = new AgentTokenAdapter();
