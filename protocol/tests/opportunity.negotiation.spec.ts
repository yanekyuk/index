import { config } from "dotenv";
config({ path: ".env.development" });

import { describe, it, expect, mock } from "bun:test";

describe("Opportunity Graph — Negotiation Integration", () => {
  it("negotiateNode filters candidates by negotiation consensus", async () => {
    const mockNegotiationGraph = {
      invoke: mock((input: any) => {
        const isFirstCandidate = input.candidateUser.id === "candidate-1";
        return Promise.resolve({
          outcome: {
            consensus: isFirstCandidate,
            finalScore: isFirstCandidate ? 82 : 0,
            agreedRoles: isFirstCandidate
              ? [{ userId: "source", role: "peer" }, { userId: "candidate-1", role: "peer" }]
              : [],
            reasoning: isFirstCandidate ? "Good match" : "No fit",
            turnCount: 2,
          },
        });
      }),
    };

    const { negotiateCandidates } = await import("../src/lib/protocol/graphs/negotiation.graph");

    const candidates = [
      { userId: "candidate-1", score: 78, reasoning: "OK", valencyRole: "Peer" },
      { userId: "candidate-2", score: 72, reasoning: "Weak", valencyRole: "Agent" },
    ];

    const sourceUser = {
      id: "source",
      intents: [{ id: "i1", title: "Test", description: "Test intent", confidence: 0.9 }],
      profile: { name: "Alice" },
      hydeDocuments: [],
    };

    const results = await negotiateCandidates(
      mockNegotiationGraph as any,
      sourceUser,
      candidates.map((c) => ({
        ...c,
        candidateUser: {
          id: c.userId,
          intents: [{ id: "i2", title: "Test", description: "Counter intent", confidence: 0.8 }],
          profile: { name: c.userId },
          hydeDocuments: [],
        },
      })),
      { indexId: "idx-1", prompt: "Test" },
    );

    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe("candidate-1");
    expect(results[0].negotiationScore).toBe(82);
  }, 30_000);
});
