/**
 * Shared persist phase for opportunity creation: enrichOrCreate → create (or create+expire) → optional chat injection.
 * Used by the opportunity graph persist node and by the manual opportunity service for consistency.
 */

import type { CreateOpportunityData, Opportunity } from '../interfaces/database.interface';
import type { Embedder } from '../interfaces/embedder.interface';
import type { EnricherDatabase } from './opportunity.enricher';
import { enrichOrCreate } from './opportunity.enricher';
import { protocolLogger } from './protocol.logger';

const logger = protocolLogger('OpportunityPersist');

export type PersistOpportunityDatabase = EnricherDatabase & {
  createOpportunity(data: CreateOpportunityData): Promise<Opportunity>;
  updateOpportunityStatus(id: string, status: 'expired' | 'accepted' | 'rejected' | 'pending' | 'latent' | 'viewed'): Promise<void>;
  createOpportunityAndExpireIds?(
    data: CreateOpportunityData,
    expireIds: string[]
  ): Promise<{ created: Opportunity; expired: Opportunity[] }>;
};

export interface PersistOpportunitiesParams {
  database: PersistOpportunityDatabase;
  embedder: Embedder;
  items: CreateOpportunityData[];
  injectChat?: (opportunity: Opportunity) => Promise<unknown>;
}

export interface PersistOpportunitiesResult {
  created: Opportunity[];
  expired: Opportunity[];
}

/**
 * Persist one or more opportunities: enrich (merge overlapping), create, expire replaced, optional chat injection.
 * When the database has createOpportunityAndExpireIds and enrichment produced expireIds, uses it for atomic create+expire.
 * Returns both created and expired so callers can emit events (e.g. manual service).
 */
export async function persistOpportunities(params: PersistOpportunitiesParams): Promise<PersistOpportunitiesResult> {
  const { database, embedder, items, injectChat } = params;
  const created: Opportunity[] = [];
  const expired: Opportunity[] = [];

  for (const data of items) {
    const enrichment = await enrichOrCreate(database, embedder, data);
    const toCreate = enrichment.data;
    if (enrichment.enriched) {
      toCreate.status = enrichment.resolvedStatus;
    }

    if (
      database.createOpportunityAndExpireIds &&
      enrichment.enriched &&
      enrichment.expiredIds.length > 0
    ) {
      const result = await database.createOpportunityAndExpireIds(toCreate, enrichment.expiredIds);
      created.push(result.created);
      expired.push(...result.expired);
    } else {
      const c = await database.createOpportunity(toCreate);
      created.push(c);
      if (enrichment.enriched && enrichment.expiredIds.length > 0) {
        for (const id of enrichment.expiredIds) {
          await database.updateOpportunityStatus(id, 'expired');
        }
      }
    }

    const lastCreated = created[created.length - 1];
    if (lastCreated!.status === 'pending' && injectChat) {
      await injectChat(lastCreated!).catch((err) => {
        logger.warn('[PersistOpportunities] Chat injection failed', { opportunityId: lastCreated!.id, error: err });
      });
    }
  }

  return { created, expired };
}
