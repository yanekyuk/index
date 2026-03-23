/** Config */
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, test, expect } from "bun:test";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

import { extractRecentToolCalls } from "./chat.prompt.modules";

describe("extractRecentToolCalls", () => {
  test("returns empty array when no tool calls in messages", () => {
    const messages = [new HumanMessage("hello")];
    const result = extractRecentToolCalls(messages);
    expect(result).toEqual([]);
  });

  test("returns tool calls from most recent AI message", () => {
    const messages = [
      new HumanMessage("find me a mentor"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc1", name: "create_opportunities", args: { searchQuery: "mentor" }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc1", content: "results...", name: "create_opportunities" }),
    ];
    const result = extractRecentToolCalls(messages);
    expect(result).toEqual([{ name: "create_opportunities", args: { searchQuery: "mentor" } }]);
  });

  test("collects tool calls from ALL AI messages since last HumanMessage", () => {
    const messages = [
      new HumanMessage("find me a mentor"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc1", name: "read_user_profiles", args: {}, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc1", content: "profile data", name: "read_user_profiles" }),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc2", name: "create_opportunities", args: { searchQuery: "mentor" }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc2", content: "results...", name: "create_opportunities" }),
    ];
    const result = extractRecentToolCalls(messages);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(["read_user_profiles", "create_opportunities"]);
  });

  test("resets scope on new HumanMessage", () => {
    const messages = [
      new HumanMessage("first question"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc1", name: "read_intents", args: {}, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc1", content: "old intents", name: "read_intents" }),
      new HumanMessage("second question"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc2", name: "create_intent", args: { description: "test" }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc2", content: "created", name: "create_intent" }),
    ];
    const result = extractRecentToolCalls(messages);
    expect(result).toEqual([{ name: "create_intent", args: { description: "test" } }]);
  });

  test("handles AI message with multiple parallel tool calls", () => {
    const messages = [
      new HumanMessage("introduce Alice and Bob"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc1", name: "read_user_profiles", args: { userId: "alice" }, type: "tool_call" },
          { id: "tc2", name: "read_user_profiles", args: { userId: "bob" }, type: "tool_call" },
          { id: "tc3", name: "read_index_memberships", args: { userId: "alice" }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc1", content: "alice profile", name: "read_user_profiles" }),
      new ToolMessage({ tool_call_id: "tc2", content: "bob profile", name: "read_user_profiles" }),
      new ToolMessage({ tool_call_id: "tc3", content: "alice memberships", name: "read_index_memberships" }),
    ];
    const result = extractRecentToolCalls(messages);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ name: "read_user_profiles", args: { userId: "alice" } });
    expect(result[2]).toEqual({ name: "read_index_memberships", args: { userId: "alice" } });
  });
});
