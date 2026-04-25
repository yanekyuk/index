import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it } from "bun:test";

import { viewerCentricCardSummary } from "../opportunity.presentation.js";

// ═══════════════════════════════════════════════════════════════════════════════
// viewerCentricCardSummary
// ═══════════════════════════════════════════════════════════════════════════════

describe("viewerCentricCardSummary", () => {
  // ── Existing behavior (should remain unchanged) ──

  it("returns fallback when reasoning is empty", () => {
    expect(viewerCentricCardSummary("", "Alex Chen")).toBe(
      "A suggested connection.",
    );
  });

  it("returns full reasoning when counterpartName is empty", () => {
    const reasoning = "Two developers with complementary skills.";
    expect(viewerCentricCardSummary(reasoning, "")).toBe(reasoning);
  });

  it("returns sentences starting from counterpart mention", () => {
    const reasoning =
      "The source user needs a React developer. Alex Chen is a full-stack engineer focused on React and Node.";
    expect(viewerCentricCardSummary(reasoning, "Alex Chen")).toBe(
      "Alex Chen is a full-stack engineer focused on React and Node.",
    );
  });

  it("returns full reasoning when counterpart name not found", () => {
    const reasoning = "Both users have complementary skills in web development.";
    expect(viewerCentricCardSummary(reasoning, "Unknown Person")).toBe(
      reasoning,
    );
  });

  // ── Bug 2: Viewer self-referencing text ──

  it("strips viewer-describing prefix from compound sentence mentioning both names", () => {
    const reasoning =
      "Yankı Ekin Yüksel is interested in AI in software development and could potentially collaborate with Elena Petrova, an applied AI researcher building an AI operations toolkit and looking for technical collaborators.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Elena Petrova",
      500,
      "Yankı Ekin Yüksel",
    );
    expect(result).not.toMatch(/^Yankı/);
    expect(result).toContain("Elena Petrova");
  });

  it("strips viewer-describing prefix when sentence starts with viewer first name", () => {
    const reasoning =
      "Yankı is looking to recruit designers for a game development studio. Yuki Tanaka is a visual artist and illustrator with a focus on character design.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Yuki Tanaka",
      500,
      "Yankı Ekin Yüksel",
    );
    expect(result).toMatch(/^Yuki Tanaka/);
  });

  it("works without viewerName (backwards compatible)", () => {
    const reasoning =
      "Alex Chen is a full-stack engineer focused on React and Node.";
    expect(viewerCentricCardSummary(reasoning, "Alex Chen")).toBe(reasoning);
  });

  it("prefers sentences that start with counterpart name over compound sentences", () => {
    const reasoning =
      "The viewer is interested in AI and could work with Elena Petrova. Elena Petrova is an applied AI researcher building an AI operations toolkit.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Elena Petrova",
      500,
      "The viewer",
    );
    expect(result).toMatch(/^Elena Petrova is an applied AI researcher/);
  });

  it("handles single compound sentence with both names by extracting counterpart part", () => {
    const reasoning =
      "Yankı Ekin Yüksel is interested in AI in software development and could potentially collaborate with Elena Petrova, an applied AI researcher building an AI operations toolkit.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Elena Petrova",
      500,
      "Yankı Ekin Yüksel",
    );
    expect(result).toContain("Elena Petrova");
    expect(result).not.toMatch(/^Yankı/);
  });

  it("keeps viewer wording for presenter input (user-facing cards use OpportunityPresenter)", () => {
    const reasoning =
      "Given Yankı's interest in game development and shadow puppetry, Yuki Tanaka is a strong match. She is a visual artist and illustrator with a focus on character design.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Yuki Tanaka",
      500,
      "Yankı Ekin Yüksel",
    );
    expect(result).toContain("Yankı's");
    expect(result).toContain("Yuki Tanaka");
  });

  // ── IND-113: Introducer stripping ──

  it("strips introducer from summary with counterpart", () => {
    const reasoning = "Seref Yarar introduced you to Lucy, who is actively seeking a product co-founder.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Lucy",
      200,
      "Viewer Name",
      "Seref Yarar"
    );
    expect(result).not.toContain("Seref");
    expect(result).toContain("Lucy");
  });

  it("strips introducer when viewerName is not provided", () => {
    const reasoning = "Bob thinks you should meet Alice because your skills align.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Alice",
      200,
      undefined,
      "Bob"
    );
    expect(result).not.toContain("Bob");
    expect(result).toContain("Alice");
  });

  it("does not modify text when introducerName is undefined", () => {
    const reasoning = "Alice is seeking a co-founder for her marketplace.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Alice",
      200,
      "Viewer",
      undefined
    );
    expect(result).toBe(reasoning);
  });

  it("handles reasoning with viewer-centric transform then introducer strip", () => {
    const reasoning = "Bob thinks Viewer should meet Alice.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Alice",
      200,
      "Viewer",
      "Bob"
    );
    expect(result).not.toContain("Bob");
    expect(result).toContain("Alice");
  });

  it("truncates correctly after introducer removal", () => {
    const reasoning = "Seref introduced you to Lucy, who has very long description about many things she is working on and seeking help with.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Lucy",
      50,
      undefined,
      "Seref"
    );
    expect(result.length).toBeLessThanOrEqual(53); // 50 + "..."
    expect(result).not.toContain("Seref");
  });
});
