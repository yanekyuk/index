import { useMemo } from 'react';
import { useAuthenticatedAPI } from '../lib/api';

export interface ComposioConnection {
  id: string;
  toolkit: string;
  status: string;
  createdAt: string;
}

export interface ImportContactsResult {
  imported: number;
  skipped: number;
  newContacts: number;
  existingContacts: number;
}

export const createIntegrationsService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  getConnections: async (indexId?: string): Promise<{ connections: ComposioConnection[] }> => {
    const qs = indexId ? `?indexId=${encodeURIComponent(indexId)}` : '';
    return api.get<{ connections: ComposioConnection[] }>(`/integrations${qs}`);
  },

  connect: async (toolkit: string): Promise<{ redirectUrl: string }> => {
    return api.post<{ redirectUrl: string }>(`/integrations/connect/${toolkit}`);
  },

  linkIntegration: async (toolkit: string, indexId: string): Promise<{ success: boolean }> => {
    return api.post<{ success: boolean }>(`/integrations/${toolkit}/link`, { indexId });
  },

  unlinkIntegration: async (toolkit: string, indexId: string): Promise<{ success: boolean }> => {
    return api.delete<{ success: boolean }>(`/integrations/${toolkit}/link?indexId=${encodeURIComponent(indexId)}`);
  },

  disconnect: async (id: string): Promise<{ success: boolean }> => {
    return api.delete<{ success: boolean }>(`/integrations/${id}`);
  },

  importContacts: async (toolkit: string, indexId?: string): Promise<ImportContactsResult> => {
    return api.post<ImportContactsResult>(`/integrations/${toolkit}/import`, { indexId });
  },
});

export function useIntegrationsService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createIntegrationsService(api), [api]);
}
