import { describe, expect, it } from "vitest";
import { filterStreamingDraftsForDisplay } from "./streaming-drafts-dedupe";

describe("filterStreamingDraftsForDisplay", () => {
  it("drops drafts whose opportunityId already exists in message content", () => {
    const inContent = new Set(["opp-1", "opp-2"]);
    const drafts = [
      { opportunityId: "opp-1", x: 1 },
      { opportunityId: "opp-3", x: 2 },
    ] as const;
    const r = filterStreamingDraftsForDisplay([...drafts], inContent);
    expect(r).toEqual([{ opportunityId: "opp-3", x: 2 }]);
  });

  it("keeps the first draft when metadata repeats the same opportunityId", () => {
    const r = filterStreamingDraftsForDisplay(
      [
        { opportunityId: "a", n: 1 },
        { opportunityId: "a", n: 2 },
      ],
      new Set(),
    );
    expect(r).toEqual([{ opportunityId: "a", n: 1 }]);
  });
});
