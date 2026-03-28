import { useMemo } from 'react';
import type { Index } from '@/types';
import type { PaginatedResponse } from '@/types';
import { apiClient } from '@/lib/api';

/** Response shape from GET /indexes (member + personal indexes; "Everywhere" is static in UI). */
export interface IndexListV2Response {
  networks: Index[];
  pagination: { current: number; total: number; count: number; totalCount: number };
}

export function createIndexesServiceV2() {
  return {
    getIndexes: async (): Promise<PaginatedResponse<Index>> => {
      const data = await apiClient.get<IndexListV2Response>('/indexes');
      return {
        data: data.networks ?? [],
        pagination: data.pagination ?? { current: 1, total: 0, count: 0, totalCount: 0 },
      };
    },

    getPublicIndexes: async (): Promise<PaginatedResponse<Index>> => {
      const data = await apiClient.get<IndexListV2Response>('/indexes/discovery/public');
      return {
        data: data.networks ?? [],
        pagination: data.pagination ?? { current: 1, total: 0, count: 0, totalCount: 0 },
      };
    },

    joinPublicIndex: async (indexId: string): Promise<Index> => {
      const data = await apiClient.post<{ index: Index }>(`/indexes/${indexId}/join`);
      return data.index;
    },
  };
}

export function useIndexesV2() {
  return useMemo(() => createIndexesServiceV2(), []);
}
