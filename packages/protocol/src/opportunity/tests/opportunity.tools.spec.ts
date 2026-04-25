import { config } from "dotenv";
config({ path: ".env.development", override: true });

import { describe, expect, it } from "bun:test";
import {
  getPrimaryActionLabel,
  PRIMARY_ACTION_LABEL_DEFAULT,
  PRIMARY_ACTION_LABEL_INTRODUCER,
} from "../opportunity.labels.js";

describe("getPrimaryActionLabel", () => {
  it("maps party to Start Chat", () => {
    expect(getPrimaryActionLabel("party")).toBe(PRIMARY_ACTION_LABEL_DEFAULT);
  });

  it("maps introducer to Good match", () => {
    expect(getPrimaryActionLabel("introducer")).toBe(PRIMARY_ACTION_LABEL_INTRODUCER);
  });
});
