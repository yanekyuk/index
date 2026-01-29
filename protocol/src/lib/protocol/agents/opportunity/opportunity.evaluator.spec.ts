import { config } from "dotenv";
config({ path: 'protocol/.env.development', override: true });

import { describe, expect, it } from "bun:test";
import { OpportunityEvaluator, CandidateProfile } from "./opportunity.evaluator";

describe('OpportunityEvaluator', () => {
  const evaluator = new OpportunityEvaluator();

  const sourceProfile = `
        Name: Alice
        Bio: Senior Blockchain Developer building a DeFi protocol.
        Skills: Rust, Solidity, React.
        Interests: DeFi, Zero Knowledge Proofs.
    `;

  const candidates: CandidateProfile[] = [
    {
      userId: "user-bob",
      identity: { name: "Bob", bio: "Crypto investor and community manager.", location: "NYC" },
      attributes: { skills: ["Marketing", "Community"], interests: ["DeFi", "Bitcoin"] }
    },
    {
      userId: "user-charlie",
      identity: { name: "Charlie", bio: "Chef.", location: "Paris" },
      attributes: { skills: ["Cooking"], interests: ["Food"] }
    }
  ];

  it('should find a high-value match', async () => {
    const result = await evaluator.invoke(sourceProfile, candidates, { minScore: 50 });

    expect(result.length).toBeGreaterThan(0);
    const match = result[0];
    expect(match.candidateId).toBe("user-bob");
    expect(match.score).toBeGreaterThan(50);
    expect(match.sourceDescription).toBeDefined();
    expect(match.candidateDescription).toBeDefined();
  }, 60000);

  it('should filter out low relevance candidates', async () => {
    // For this test, we need the mock to return DIFFERENT results based on input, or simpler:
    // We can just create a new evaluator with a mock that returns NOTHING.

    // Actually, the current logic filters based on returned score.
    // My simple mock always returns score 95 for "user-bob".
    // It doesn't return "user-charlie".
    // So "user-charlie" is implicitly filtered out because the mock didn't return it.

    const result = await evaluator.invoke(sourceProfile, candidates, { minScore: 90 });

    const charlieMatch = result.find(r => r.candidateId === "user-charlie");
    expect(charlieMatch).toBeUndefined();
  }, 60000);
});
