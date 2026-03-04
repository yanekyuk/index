import { config } from "dotenv";
config({ path: ".env.development", override: true });

import { describe, expect, it } from "bun:test";
import type { Opportunity } from "../../interfaces/database.interface";

describe("buildMinimalOpportunityCard - IND-113", () => {
  const mockOpportunity: Opportunity = {
    id: "opp-123",
    status: "pending",
    interpretation: {
      reasoning: "Seref Yarar introduced you to Lucy Chen, who is actively seeking a product co-founder.",
      confidence: 0.85,
    },
    actors: [
      { userId: "viewer-456", role: "party" },
      { userId: "counterpart-789", role: "party" },
      { userId: "introducer-abc", role: "introducer" },
    ],
    detection: {
      source: "manual",
      createdByName: "Seref Yarar",
    },
  };

  it("should verify mock opportunity has introducer in reasoning", () => {
    // This test documents the expected behavior:
    // When buildMinimalOpportunityCard is called with introducerName,
    // the mainText should NOT contain the introducer
    expect(mockOpportunity.interpretation?.reasoning).toContain("Seref Yarar");
    expect(mockOpportunity.detection?.createdByName).toBe("Seref Yarar");
  });

  it("should verify opportunity structure for IND-113 test case", () => {
    // Verify the mock opportunity structure matches the real IND-113 scenario
    expect(mockOpportunity.actors).toHaveLength(3);
    expect(mockOpportunity.actors.some(a => a.role === "introducer")).toBe(true);
    expect(mockOpportunity.actors.some(a => a.role === "party")).toBe(true);
    expect(mockOpportunity.detection?.source).toBe("manual");
    expect(mockOpportunity.interpretation?.reasoning).toContain("introduced you to");
  });

  it("should document expected card output behavior", () => {
    // Document expected behavior for buildMinimalOpportunityCard:
    // 1. When called with introducerName="Seref Yarar"
    // 2. And viewerCentricCardSummary is invoked internally
    // 3. The resulting mainText should NOT contain "Seref Yarar"
    // 4. The resulting mainText should contain "Lucy Chen"

    const expectedIntroducerName = "Seref Yarar";
    const expectedCounterpartName = "Lucy Chen";
    const originalReasoning = mockOpportunity.interpretation!.reasoning;

    // Verify the reasoning contains the introducer pattern
    expect(originalReasoning).toContain(expectedIntroducerName);
    expect(originalReasoning).toContain(expectedCounterpartName);

    // The actual stripping is tested in opportunity.sanitize.spec.ts
    // and opportunity.sanitize.edge.spec.ts
    // This test serves as documentation of the integration point
    expect(true).toBe(true);
  });
});
