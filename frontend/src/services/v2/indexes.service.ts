import { useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import type { Index } from '@/types';
import type { PaginatedResponse } from '@/types';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

/** Response shape from GET /indexes (member + personal indexes; "Everywhere" is static in UI). */
export interface IndexListV2Response {
  indexes: Index[];
  pagination: { current: number; total: number; count: number; totalCount: number };
}

async function v2Fetch(
  path: string,
  options: RequestInit & { accessToken: string }
): Promise<Response> {
  const { accessToken, ...init } = options;
  const url = `${API_BASE_URL}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function createIndexesServiceV2(getAccessToken: () => Promise<string | null>) {
  return {
    /**
     * List indexes the user is a member of (including personal index).
     * GET /indexes. "Everywhere" is not returned (static UI option).
     */
    getIndexes: async (): Promise<PaginatedResponse<Index>> => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const res = await v2Fetch('/indexes', { method: 'GET', accessToken: token });

      if (!res.ok) {
        let message = res.statusText;
        try {
          const data = (await res.json()) as { error?: string };
          message = data.error ?? message;
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      const data = (await res.json()) as IndexListV2Response;
      return {
        data: data.indexes ?? [],
        pagination: data.pagination ?? { current: 1, total: 0, count: 0, totalCount: 0 },
      };
    },

    /**
     * Get public indexes that the user has not joined (for discovery).
     * GET /indexes/discovery/public
     */
    getPublicIndexes: async (): Promise<PaginatedResponse<Index>> => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const res = await v2Fetch('/indexes/discovery/public', { method: 'GET', accessToken: token });

      if (!res.ok) {
        let message = res.statusText;
        try {
          const data = (await res.json()) as { error?: string };
          message = data.error ?? message;
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      const data = (await res.json()) as IndexListV2Response;
      return {
        data: data.indexes ?? [],
        pagination: data.pagination ?? { current: 1, total: 0, count: 0, totalCount: 0 },
      };
    },

    /**
     * Join a public index.
     * POST /indexes/:id/join
     */
    joinPublicIndex: async (indexId: string): Promise<Index> => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const res = await v2Fetch(`/indexes/${indexId}/join`, { 
        method: 'POST', 
        accessToken: token,
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        let message = res.statusText;
        try {
          const data = (await res.json()) as { error?: string };
          message = data.error ?? message;
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      const data = (await res.json()) as { index: Index };
      return data.index;
    },
  };
}

export function useIndexesV2() {
  const { getAccessToken } = usePrivy();
  return useMemo(() => createIndexesServiceV2(getAccessToken), [getAccessToken]);
}
