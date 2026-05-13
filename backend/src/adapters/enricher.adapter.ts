import type { ProfileEnricher, EnrichmentRequest, EnrichmentResult } from '@indexnetwork/protocol';
import { enrichUserProfile as parallelEnrichUserProfile } from '../lib/parallel/parallel';

/**
 * Adapter that implements the ProfileEnricher interface using the Parallel Chat API.
 * Bridges EnrichmentRequest to ParallelSearchRequestStruct and returns typed EnrichmentResult.
 */
export const enricherAdapter: ProfileEnricher = {
  async enrichUserProfile(request: EnrichmentRequest): Promise<EnrichmentResult | null> {
    const result = await parallelEnrichUserProfile(request);
    return result;
  },
};
