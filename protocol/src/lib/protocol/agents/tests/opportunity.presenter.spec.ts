import { config } from "dotenv";
config({ path: ".env.development", override: true });

import { describe, expect, it, mock } from "bun:test";
import { OpportunityPresenter, type HomeCardPresenterInput } from "../opportunity.presenter";

// ---------------------------------------------------------------------------
// Zero mutual intents – fallback path (no LLM needed)
// ---------------------------------------------------------------------------

describe("OpportunityPresenter – zero mutual intents label", () => {
  // Force the LLM to fail so we exercise the catch/fallback path.
  // We subclass and override the private invokeWithTimeout via prototype patch.
  let presenter: OpportunityPresenter;

  const baseInput: HomeCardPresenterInput = {
    viewerContext: "Name: Alice\nBio: Engineer",
    otherPartyContext: "Name: Bob\nBio: Designer",
    matchReasoning: "Both interested in AI tooling and design systems.",
    category: "collaboration",
    confidence: 0.8,
    signalsSummary: "Complementary skills",
    indexName: "Test Index",
    viewerRole: "party",
    opportunityStatus: "pending",
  };

  // Patch the presenter to always hit the fallback path
  function createFallbackPresenter(): OpportunityPresenter {
    const p = new OpportunityPresenter();
    // Force the LLM call to throw, triggering the catch/fallback branch
    (p as any).invokeWithTimeout = mock(() => {
      throw new Error("Forced fallback for testing");
    });
    return p;
  }

  it("should return 'Shared interests' when mutualIntentCount is 0", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentHomeCard({ ...baseInput, mutualIntentCount: 0 });
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should return 'Shared interests' when mutualIntentCount is undefined", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentHomeCard({ ...baseInput, mutualIntentCount: undefined });
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should return 'Shared interests' when mutualIntentCount is null", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentHomeCard({ ...baseInput, mutualIntentCount: null as any });
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should return numeric label when mutualIntentCount > 0", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentHomeCard({ ...baseInput, mutualIntentCount: 3 });
    expect(result.mutualIntentsLabel).toBe("3 mutual intents");
  });

  it("should return singular label when mutualIntentCount is 1", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentHomeCard({ ...baseInput, mutualIntentCount: 1 });
    expect(result.mutualIntentsLabel).toBe("1 mutual intent");
  });

  it("should return 'Connector match' for introducer role regardless of count", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentHomeCard({
      ...baseInput,
      viewerRole: "introducer",
      isIntroduction: true,
      introducerName: "Carol",
      mutualIntentCount: 0,
    });
    expect(result.mutualIntentsLabel).toBe("Connector match");
  });
});

// ---------------------------------------------------------------------------
// Regex safety net – catches "0 mutual intents" from LLM output
// ---------------------------------------------------------------------------

describe("OpportunityPresenter – regex safety net for LLM output", () => {
  const regex = /^0\s+(mutual|overlapping)\s+intent/i;

  it("should match '0 mutual intents'", () => {
    expect(regex.test("0 mutual intents")).toBe(true);
  });

  it("should match '0 overlapping intents'", () => {
    expect(regex.test("0 overlapping intents")).toBe(true);
  });

  it("should match '0 mutual intent' (singular)", () => {
    expect(regex.test("0 mutual intent")).toBe(true);
  });

  it("should match '0  mutual intents' (extra whitespace)", () => {
    expect(regex.test("0  mutual intents")).toBe(true);
  });

  it("should NOT match '2 mutual intents'", () => {
    expect(regex.test("2 mutual intents")).toBe(false);
  });

  it("should NOT match 'Shared interests'", () => {
    expect(regex.test("Shared interests")).toBe(false);
  });
});

describe("OpportunityPresenter - IND-113: Introducer should not appear in body text", () => {
  const presenter = new OpportunityPresenter();

  const createIntroducerInput = (
    introducerName: string,
    counterpartName: string,
  ): HomeCardPresenterInput => ({
    viewerContext: `Name: Test Viewer\nBio: UX designer with AI expertise\nActive intents:\n- Looking for collaboration opportunities`,
    otherPartyContext: `Name: ${counterpartName}\nBio: Building a marketplace startup\nSkills: product management, operations`,
    matchReasoning: `${introducerName} introduced you to ${counterpartName}, who is actively seeking a product co-founder for a niche APAC marketplace. Both parties have complementary skills in design and product development.`,
    category: "collaboration",
    confidence: 0.85,
    signalsSummary: "Complementary skills in design and product",
    indexName: "Test Index",
    viewerRole: "party",
    opportunityStatus: "pending",
    isIntroduction: true,
    introducerName,
    mutualIntentCount: 1,
  });

  it("should NOT include introducer name in personalizedSummary for introduction opportunities", async () => {
    const input = createIntroducerInput("Seref Yarar", "Lucy Chen");

    const result = await presenter.presentHomeCard(input);

    // Body text should NOT contain introducer
    expect(result.personalizedSummary).not.toContain("Seref");
    expect(result.personalizedSummary).not.toContain("Yarar");
    expect(result.personalizedSummary).not.toContain("introduced you");

    // Body text SHOULD contain counterpart
    expect(result.personalizedSummary).toContain("Lucy");

    // Narrator remark: non-empty string, within display length (e.g. ≤80)
    expect(typeof result.narratorRemark).toBe("string");
    expect(result.narratorRemark.length).toBeGreaterThan(0);
    expect(result.narratorRemark.length).toBeLessThanOrEqual(80);

    // Print output for manual review
    console.log("Headline:", result.headline);
    console.log("Summary:", result.personalizedSummary);
    console.log("NarratorRemark:", result.narratorRemark);
  }, 30000); // 30s timeout for LLM

  it("should include counterpart name in personalizedSummary", async () => {
    const input = createIntroducerInput("Bob Smith", "Alice Johnson");

    const result = await presenter.presentHomeCard(input);

    expect(result.personalizedSummary).toContain("Alice");
    expect(result.personalizedSummary.length).toBeGreaterThan(50);
  }, 30000);

  it("should set appropriate narratorRemark for introduction", async () => {
    const input = createIntroducerInput("Jane Doe", "Mark Wilson");

    const result = await presenter.presentHomeCard(input);

    expect(typeof result.narratorRemark).toBe("string");
    expect(result.narratorRemark.length).toBeGreaterThan(0);
    expect(result.narratorRemark.length).toBeLessThanOrEqual(80);
  }, 30000);
});
