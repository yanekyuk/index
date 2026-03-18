import { useMemo } from 'react';
import { useAuthenticatedAPI } from '../lib/api';

export interface ComposioConnection {
  id: string;
  toolkit: string;
  status: string;
  createdAt: string;
}

export const createIntegrationsService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  getConnections: async (): Promise<{ connections: ComposioConnection[] }> => {
    return api.get<{ connections: ComposioConnection[] }>('/integrations');
  },

  connect: async (toolkit: string): Promise<{ redirectUrl: string }> => {
    return api.post<{ redirectUrl: string }>(`/integrations/connect/${toolkit}`);
  },

  disconnect: async (id: string): Promise<{ success: boolean }> => {
    return api.delete<{ success: boolean }>(`/integrations/${id}`);
  },
});

export function useIntegrationsService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createIntegrationsService(api), [api]);
}
