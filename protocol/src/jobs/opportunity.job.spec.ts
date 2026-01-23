import * as dotenv from 'dotenv';
import path from 'path';
import { log } from '../lib/log';
import { OpportunityService } from '../services/opportunity.service';
import { OpportunityEvaluator } from '../agents/opportunity/opportunity.evaluator';
import { CandidateProfile, Opportunity } from '../agents/opportunity/opportunity.evaluator.types';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

// --- MOCKS ---

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
    log.info(`[MockService] getProfilesMissingEmbeddings called (returning ${this.profilesWithMissingEmbeddings.length})`);
    return this.profilesWithMissingEmbeddings;
  }

  async updateProfileEmbedding(profileId: string, embedding: number[]) {
    log.info(`[MockService] updateProfileEmbedding called for ${profileId} with embedding len ${embedding.length}`);
  }

  async getAllProfilesWithEmbeddings() {
    log.info(`[MockService] getAllProfilesWithEmbeddings called (returning ${this.allProfiles.length})`);
    return this.allProfiles;
  }

  async updateProfileHyde(profileId: string, hydeDescription: string, hydeEmbedding: number[]) {
    log.info(`[MockService] updateProfileHyde called for ${profileId}`);
  }

  async getProfile(userId: string) {
    log.info(`[MockService] getProfile called for ${userId}`);
    return this.allProfiles.find(p => p.userId === userId);
  }

  async getUserStakes(userId: string, limit: number = 20) {
    log.info(`[MockService] getUserStakes called for ${userId}`);
    return [];
  }

  async getUserIntentObjects(userId: string) {
    log.info(`[MockService] getUserIntentObjects called for ${userId}`);
    return [];
  }

  async createIntent(options: any) {
    log.info(`[MockService] createIntent called for ${options.userId}`);
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
    log.info(`[MockService] saveMatch called: ${newIntentId} <-> ${targetIntentId} (score: ${score})`);
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
    log.info(`[MockEvaluator] evaluateOpportunities called with context len ${sourceProfileContext.length} vs ${candidates.length} candidates`);
    if (candidates.length > 0) {
      return [
        {
          type: 'collaboration',
          title: 'Mock Opportunity',
          description: 'A mock description',
          candidateDescription: 'A mock candidate description',
          score: 95,
          candidateId: candidates[0].userId
        }
      ];
    }
    return [];
  }
}

// --- TEST RUNNER ---

async function runTests() {
  log.info("🧪 Starting Opportunity Finder Job Tests (Standalone)...\n");

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
    log.info("✅ Cycle completed successfully.");
  } catch (e) {
    log.error("❌ Cycle failed:", { error: e });
    process.exit(1);
  }
}

runTests().catch((e) => log.error('Test runner failed', { error: e }));
