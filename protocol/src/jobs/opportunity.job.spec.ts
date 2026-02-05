/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, it, expect, mock } from 'bun:test';
import { log } from '../lib/log';
import {
  expireStaleOpportunities,
  onIntentCreated,
  onIntentUpdated,
} from './opportunity.job';
import { OpportunityService } from '../services/opportunity.service';
import { OpportunityEvaluator } from '../agents/opportunity/opportunity.evaluator';
import { CandidateProfile, Opportunity } from '../agents/opportunity/opportunity.evaluator.types';

const logger = log.service.from("jobs/opportunity.job.spec.ts");

describe('OpportunityJob', () => {
  describe('expireStaleOpportunities', () => {
    it('returns count of expired opportunities', async () => {
      const expireStaleOpportunitiesDb = mock(async () => 2);
      const count = await expireStaleOpportunities({
        database: { expireStaleOpportunities: expireStaleOpportunitiesDb },
      });
      expect(count).toBe(2);
      expect(expireStaleOpportunitiesDb).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when no stale opportunities', async () => {
      const expireStaleOpportunitiesDb = mock(async () => 0);
      const count = await expireStaleOpportunities({
        database: { expireStaleOpportunities: expireStaleOpportunitiesDb },
      });
      expect(count).toBe(0);
    });
  });

  describe('onIntentCreated', () => {
    it('enqueues process_opportunities job when no userId', async () => {
      const addJob = mock(async () => ({} as any));
      await onIntentCreated('intent-123', { addJob });
      expect(addJob).toHaveBeenCalledTimes(1);
      expect(addJob).toHaveBeenCalledWith(
        'process_opportunities',
        expect.objectContaining({ force: false }),
        5
      );
    });

    it('enqueues process_opportunities and process_intent_opportunities when userId provided', async () => {
      const addJob = mock(async () => ({} as any));
      await onIntentCreated('intent-123', { addJob, userId: 'user-456' });
      expect(addJob).toHaveBeenCalledTimes(2);
      expect(addJob).toHaveBeenCalledWith(
        'process_opportunities',
        expect.objectContaining({ force: false }),
        5
      );
      expect(addJob).toHaveBeenCalledWith(
        'process_intent_opportunities',
        { intentId: 'intent-123', userId: 'user-456' },
        6
      );
    });
  });

  describe('onIntentUpdated', () => {
    it('enqueues process_opportunities job when no userId', async () => {
      const addJob = mock(async () => ({} as any));
      await onIntentUpdated('intent-456', { addJob });
      expect(addJob).toHaveBeenCalledTimes(1);
      expect(addJob).toHaveBeenCalledWith(
        'process_opportunities',
        expect.objectContaining({ force: false }),
        5
      );
    });
  });
});

/**
 * Mock OpportunityService - overrides DB methods to return test data.
 * This approach tests the service without hitting the database.
 */
class MockOpportunityService extends OpportunityService {
  profilesWithMissingEmbeddings: any[] = [];
  allProfiles: any[] = [];
  candidatesMap: Record<string, any[]> = {};

  constructor() {
    super();
  }

  async getProfilesMissingEmbeddings() {
    logger.info(`[MockService] getProfilesMissingEmbeddings called (returning ${this.profilesWithMissingEmbeddings.length})`);
    return this.profilesWithMissingEmbeddings;
  }

  async updateProfileEmbedding(profileId: string, embedding: number[]) {
    logger.info(`[MockService] updateProfileEmbedding called for ${profileId} with embedding len ${embedding.length}`);
  }

  async getAllProfilesWithEmbeddings() {
    logger.info(`[MockService] getAllProfilesWithEmbeddings called (returning ${this.allProfiles.length})`);
    return this.allProfiles;
  }

  async updateProfileHyde(profileId: string, hydeDescription: string, hydeEmbedding: number[]) {
    logger.info(`[MockService] updateProfileHyde called for ${profileId}`);
  }

  async getProfile(userId: string) {
    logger.info(`[MockService] getProfile called for ${userId}`);
    return this.allProfiles.find(p => p.userId === userId);
  }

  async getUserStakes(userId: string, limit: number = 20) {
    logger.info(`[MockService] getUserStakes called for ${userId}`);
    return [];
  }

  async getUserIntentObjects(userId: string) {
    logger.info(`[MockService] getUserIntentObjects called for ${userId}`);
    return [];
  }

  async createIntent(options: any) {
    logger.info(`[MockService] createIntent called for ${options.userId}`);
    return {
      id: 'mock-intent-id',
      payload: options.payload,
      summary: null,
      isIncognito: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: options.userId
    };
  }

  async saveMatch(newIntentId: string, targetIntentId: string, score: number, reasoning: string, agentId: string) {
    logger.info(`[MockService] saveMatch called: ${newIntentId} <-> ${targetIntentId} (score: ${score})`);
  }
}

class MockOpportunityEvaluator extends OpportunityEvaluator {
  constructor() {
    super();
  }

  async evaluateOpportunities(
    sourceProfileContext: string,
    candidates: CandidateProfile[],
    options: any = {}
  ): Promise<Opportunity[]> {
    logger.info(`[MockEvaluator] evaluateOpportunities called with context len ${sourceProfileContext.length} vs ${candidates.length} candidates`);
    if (candidates.length > 0) {
      return [
        {
          sourceId: 'source-user',
          score: 95,
          candidateId: candidates[0].userId,
          sourceDescription: 'A mock description',
          candidateDescription: 'A mock candidate description'
        }
      ];
    }
    return [];
  }
}

// --- TEST RUNNER ---

async function runTests() {
  logger.info("🧪 Starting Opportunity Finder Job Tests (Standalone)...\n");

  const mockService = new MockOpportunityService();
  const mockEvaluator = new MockOpportunityEvaluator();

  // Setup Data
  mockService.profilesWithMissingEmbeddings = [
    { id: 'uuid-1', userId: 'user-no-embed', identity: { bio: 'Content for embedding' }, attributes: {}, narrative: {} }
  ];

  mockService.allProfiles = [
    { id: 'uuid-2', userId: 'source-user', embedding: [0.1], hydeEmbedding: [0.2], hydeDescription: 'Looking for collaborators', identity: { bio: 'Source' }, attributes: {}, narrative: {} }
  ];

  mockService.candidatesMap = {
    'source-user': [
      { profile: { userId: 'candidate-1', identity: { bio: 'Candidate' }, attributes: {}, narrative: {} } }
    ]
  };

  console.log("1️⃣  Test: Standard Cycle (Backfill + Match)");
  try {
    await mockService.runOpportunityFinderCycle(mockEvaluator);
    logger.info("✅ Cycle completed successfully.");
  } catch (e) {
    logger.error("❌ Cycle failed:", { error: e });
    process.exit(1);
  }
}

runTests().catch((e) => logger.error('Test runner failed', { error: e }));
