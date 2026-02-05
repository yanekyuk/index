import { useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import type { Index } from '@/types';
import type { PaginatedResponse } from '@/types';

const V2_BASE = process.env.NEXT_PUBLIC_API_URL_V2 ?? '';

/** Response shape from GET /v2/indexes (member + personal indexes; "Everywhere" is static in UI). */
export interface IndexListV2Response {
  indexes: Index[];
  pagination: { current: number; total: number; count: number; totalCount: number };
}

async function v2Fetch(
  path: string,
  options: RequestInit & { accessToken: string }
): Promise<Response> {
  const { accessToken, ...init } = options;
  const url = `${V2_BASE}${path}`;
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
     * GET /v2/indexes. "Everywhere" is not returned (static UI option).
     */
    getIndexes: async (): Promise<PaginatedResponse<Index>> => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const res = await v2Fetch('/v2/indexes', { method: 'GET', accessToken: token });

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
  };
}

export function useIndexesV2() {
  const { getAccessToken } = usePrivy();
  return useMemo(() => createIndexesServiceV2(getAccessToken), [getAccessToken]);
}
