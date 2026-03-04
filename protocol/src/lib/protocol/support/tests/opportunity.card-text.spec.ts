import { describe, expect, it } from "bun:test";

import { viewerCentricCardSummary, narratorRemarkFromReasoning } from "../opportunity.card-text";

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
    // Should NOT start with the viewer's name
    expect(result).not.toMatch(/^Yankı/);
    // Should mention Elena Petrova
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
    // Should start with Yuki's sentence, not the viewer's
    expect(result).toMatch(/^Yuki Tanaka/);
  });

  it("works without viewerName (backwards compatible)", () => {
    const reasoning =
      "Alex Chen is a full-stack engineer focused on React and Node.";
    // No viewerName param — should work the same as before
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
    // Should prefer the sentence that starts with Elena
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
    // Should extract the counterpart portion
    expect(result).toContain("Elena Petrova");
    expect(result).not.toMatch(/^Yankı/);
  });

  it("replaces viewer name with you/your so card addresses viewer in second person", () => {
    const reasoning =
      "Given Yankı's interest in game development and shadow puppetry, Yuki Tanaka is a strong match. She is a visual artist and illustrator with a focus on character design.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Yuki Tanaka",
      500,
      "Yankı Ekin Yüksel",
    );
    expect(result).toContain("your interest");
    expect(result).not.toContain("Yankı's");
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
    // First transforms "Viewer" to "you", then strips "Bob thinks"
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

describe("narratorRemarkFromReasoning", () => {
  it("returns a fallback when reasoning is empty", () => {
    const result = narratorRemarkFromReasoning("", "Alex Chen");
    expect(result).toBe("A potential connection worth exploring.");
  });

  it("produces a remark that differs from the static default", () => {
    const reasoning =
      "Both users share deep expertise in AI and machine learning, making them strong collaborators.";
    const result = narratorRemarkFromReasoning(reasoning, "Alex Chen");
    expect(result).not.toBe("Based on your overlap in this community.");
  });

  it("keeps the remark under 80 characters", () => {
    const reasoning =
      "Yankı Ekin Yüksel is interested in AI in software development and could potentially collaborate with Elena Petrova, an applied AI researcher building an AI operations toolkit and looking for technical collaborators in the machine learning space.";
    const result = narratorRemarkFromReasoning(reasoning, "Elena Petrova", "Yankı Ekin Yüksel");
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it("does not include the counterpart full name in the remark", () => {
    const reasoning =
      "Elena Petrova is an applied AI researcher. Strong match for mentorship collaboration.";
    const result = narratorRemarkFromReasoning(reasoning, "Elena Petrova");
    expect(result).not.toContain("Elena Petrova");
  });

  it("produces different remarks for different reasoning texts", () => {
    const r1 = narratorRemarkFromReasoning(
      "Both share expertise in AI and machine learning.",
      "Alex Chen",
    );
    const r2 = narratorRemarkFromReasoning(
      "One is looking for a designer, the other is a UX specialist.",
      "Yuki Tanaka",
    );
    expect(r1).not.toBe(r2);
  });

  it("strips UUIDs from the remark", () => {
    const reasoning =
      "Match e037ca5a-d5ce-426e-80d1-376abc123def between users based on complementary skills.";
    const result = narratorRemarkFromReasoning(reasoning, "Someone");
    expect(result).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("does not include the counterpart's name", () => {
    const reasoning =
      "Alex Chen has strong React skills. The viewer needs a frontend developer.";
    const result = narratorRemarkFromReasoning(reasoning, "Alex Chen");
    expect(result.toLowerCase()).not.toContain("alex chen");
    expect(result.toLowerCase()).not.toContain("alex");
  });

  it("does not include the viewer's name when provided", () => {
    const reasoning =
      "Yankı Ekin Yüksel is interested in AI in software development and could potentially collaborate with Elena Petrova, an applied AI researcher.";
    const result = narratorRemarkFromReasoning(reasoning, "Elena Petrova", "Yankı Ekin Yüksel");
    expect(result.toLowerCase()).not.toContain("yankı");
    expect(result.toLowerCase()).not.toContain("elena");
  });

  it("produces a complete sentence without trailing ...", () => {
    const reasoning =
      "Yankı Ekin Yüksel is actively seeking to recruit developers for a game development studio. Yuki Tanaka is a visual artist and illustrator.";
    const result = narratorRemarkFromReasoning(reasoning, "Yuki Tanaka", "Yankı Ekin Yüksel");
    expect(result).not.toMatch(/\.\.\.$/);
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it("extracts domain-relevant content from reasoning", () => {
    const reasoning =
      "Both users share deep expertise in AI and machine learning, making them strong collaborators.";
    const result = narratorRemarkFromReasoning(reasoning, "Alex Chen");
    // Should mention the domain (AI, machine learning) or the relationship type
    expect(result.toLowerCase()).toMatch(/ai|machine learning|expertise|collaborat/);
  });

  // ── IND-113: Introducer handling in narrator remark ──

  it("extracts domain terms from reasoning with introducer", () => {
    const reasoning = "Seref introduced you to Lucy, who works in AI and machine learning.";
    const result = narratorRemarkFromReasoning(reasoning, "Lucy", "Viewer");
    expect(result).toContain("AI");
  });

  it("handles reasoning without clear domain terms", () => {
    const reasoning = "Seref introduced you to Lucy. You should connect.";
    const result = narratorRemarkFromReasoning(reasoning, "Lucy", "Viewer");
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(80);
  });
});
