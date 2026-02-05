/**
 * Unit tests for chat.utils (token utilities and selectStrategiesFromQuery).
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect } from "bun:test";
import {
  estimateTokenCount,
  truncateToTokenLimit,
  selectStrategiesFromQuery,
} from "./chat.utils";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

describe("chat.utils", () => {
  describe("estimateTokenCount", () => {
    test("returns 0 for empty string", () => {
      expect(estimateTokenCount("")).toBe(0);
    });
    test("estimates ~4 chars per token", () => {
      expect(estimateTokenCount("hello")).toBe(2);
      expect(estimateTokenCount("hello world")).toBe(3);
    });
  });

  describe("truncateToTokenLimit", () => {
    test("returns empty array for no messages", () => {
      expect(truncateToTokenLimit([])).toEqual([]);
    });
    test("returns single message as-is", () => {
      const msg = new HumanMessage("Hi");
      expect(truncateToTokenLimit([msg])).toEqual([msg]);
    });
  });

  describe("selectStrategiesFromQuery", () => {
    test("returns mirror and reciprocal for empty or generic query", () => {
      expect(selectStrategiesFromQuery("")).toEqual(["mirror", "reciprocal"]);
      expect(selectStrategiesFromQuery("   ")).toEqual(["mirror", "reciprocal"]);
      expect(selectStrategiesFromQuery("find someone")).toEqual([
        "mirror",
        "reciprocal",
      ]);
    });

    test('adds mentor for "find me a mentor" and guidance phrasing', () => {
      const strategies = selectStrategiesFromQuery("find me a mentor");
      expect(strategies).toContain("mirror");
      expect(strategies).toContain("reciprocal");
      expect(strategies).toContain("mentor");
    });

    test('adds mentor for "looking for guidance" and "learn from"', () => {
      expect(selectStrategiesFromQuery("I want to learn from an expert")).toContain("mentor");
      expect(selectStrategiesFromQuery("looking for guidance")).toContain("mentor");
    });

    test('adds hiree for "who needs a React developer" and hiring phrasing', () => {
      const strategies = selectStrategiesFromQuery("who needs a React developer");
      expect(strategies).toContain("hiree");
      expect(strategies).toContain("mirror");
      expect(strategies).toContain("reciprocal");
    });

    test('adds hiree for hiring/job/role phrases', () => {
      expect(selectStrategiesFromQuery("we are hiring a frontend engineer")).toContain("hiree");
      expect(selectStrategiesFromQuery("who is looking for a designer")).toContain("hiree");
      expect(selectStrategiesFromQuery("developer needed")).toContain("hiree");
    });

    test('adds investor for funding/raise phrases', () => {
      const strategies = selectStrategiesFromQuery("find investors for my startup");
      expect(strategies).toContain("investor");
      expect(selectStrategiesFromQuery("we need to raise seed")).toContain("investor");
    });

    test('adds collaborator for co-founder/partner phrases', () => {
      const strategies = selectStrategiesFromQuery("looking for a technical co-founder");
      expect(strategies).toContain("collaborator");
      expect(selectStrategiesFromQuery("find a partner to build together")).toContain(
        "collaborator"
      );
    });

    test("deduplicates strategies", () => {
      const strategies = selectStrategiesFromQuery(
        "find me a mentor and someone to learn from"
      );
      const mentorCount = strategies.filter((s) => s === "mentor").length;
      expect(mentorCount).toBe(1);
    });

    test("combines multiple strategy triggers", () => {
      const strategies = selectStrategiesFromQuery(
        "I need a mentor and want to raise funding"
      );
      expect(strategies).toContain("mentor");
      expect(strategies).toContain("investor");
      expect(strategies).toContain("mirror");
      expect(strategies).toContain("reciprocal");
    });
  });
});
