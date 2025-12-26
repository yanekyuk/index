
import { OpportunityEvaluator } from './opportunity.evaluator';
import { memorySearcher } from '../../lib/embedder/searchers/memory.searcher';
import { Embedder, VectorSearchResult, VectorStoreOption } from '../common/types';
import { CandidateProfile } from './opportunity.evaluator.types';
import { UserMemoryProfile } from '../intent/manager/intent.manager.types';
import { log } from '../../lib/log';

// Mock Embedder that uses MemorySearcher
class MockMemoryEmbedder implements Embedder {
  async generate(text: string | string[], dimensions?: number): Promise<number[] | number[][]> {
    // Return a fixed dummy vector for testing
    // In real memory search, we'd need meaningful vectors, but for unit testing the flow:
    // We will manually assign vectors to candidates to ensure "match" logic works in the searcher.
    // If we want "A" to match "A", we give them same vector.
    return [1, 0, 0];
  }

  async search<T>(queryVector: number[], collection: string, options?: VectorStoreOption<T>): Promise<VectorSearchResult<T>[]> {
    return memorySearcher(queryVector, collection, options);
  }
}

// Mock Data
const sourceProfile: UserMemoryProfile = {
  identity: { name: "Alice", bio: "AI Researcher", location: "NYC" },
  narrative: { context: "Building AGI", aspirations: "Find a co-founder" },
  attributes: { interests: ["AI", "Crypto"], skills: ["Python", "TS"] }
} as any;

const candidateA: CandidateProfile & { embedding: number[] } = {
  userId: "user-a",
  identity: { name: "Bob", bio: "Crypto Dev" },
  narrative: {},
  attributes: {},
  embedding: [0, 1, 0] // Orthogonal to query [1,0,0] -> Similarity 0
};

const candidateB: CandidateProfile & { embedding: number[] } = {
  userId: "user-b",
  identity: { name: "Charlie", bio: "AI Engineer" },
  narrative: {},
  attributes: {},
  embedding: [1, 0, 0] // Identical to query [1,0,0] -> Similarity 1
};


async function runTest() {
  log.info("--- Starting Opportunity Evaluator + Memory Search Test ---");

  const embedder = new MockMemoryEmbedder();
  const evaluator = new OpportunityEvaluator(embedder);

  // Mock the LLM evaluateOpportunities call to avoid hitting real OpenAI
  // We strictly want to test the *Retrieval* flow here (runDiscovery)
  evaluator.evaluateOpportunities = async (source, candidates) => {
    log.info(`[MockLLM] Evaluating ${candidates.length} candidates.`);
    return candidates.map(c => ({
      type: 'collaboration',
      title: `Match with ${c.identity.name}`,
      description: 'Good match',
      score: 90,
      candidateId: c.userId
    }));
  };

  const opportunities = await evaluator.runDiscovery(sourceProfile, {
    candidates: [candidateA, candidateB], // Memory Store
    limit: 5,
    minScore: 0.5 // Should filter out candidateA (score 0)
  });

  log.info("Opportunities Found: " + JSON.stringify(opportunities, null, 2));

  if (opportunities.length !== 1) {
    throw new Error(`Expected 1 opportunity, found ${opportunities.length}`);
  }
  if (opportunities[0].candidateId !== 'user-b') {
    throw new Error(`Expected Charlie (user-b), found ${opportunities[0].candidateId}`);
  }

  log.info("--- Test Passed ---");
}

runTest().catch(console.error);
