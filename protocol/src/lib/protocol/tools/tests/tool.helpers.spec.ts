/** Config */
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, test } from "bun:test";
import type { ChatGraphCompositeDatabase } from "../../interfaces/database.interface";
import {
  ChatContextAccessError,
  resolveChatContext,
} from "../tool.helpers";

const userId = "00000000-0000-4000-8000-000000000111";
const indexId = "00000000-0000-4000-8000-000000000222";

function createContextDatabase(overrides?: Partial<ChatGraphCompositeDatabase>) {
  const base = {
    getUser: async () => ({
      id: userId,
      name: "Test User",
      email: "test@example.com",
      location: "Remote",
      socials: { github: "https://github.com/test" },
    }),
    getProfile: async () => ({
      userId,
      identity: { name: "Test User", bio: "Builder", location: "Remote" },
      narrative: { context: "Building useful systems." },
      attributes: { skills: ["TypeScript"], interests: ["AI"] },
      embedding: null,
    }),
    getIndexMemberships: async () => ([
      {
        indexId,
        indexTitle: "AI Builders",
        indexPrompt: "People building practical AI tools",
        permissions: ["member"],
        memberPrompt: null,
        autoAssign: true,
        joinedAt: new Date("2026-01-01"),
      },
    ]),
    getIndex: async (id: string) => ({ id, title: "AI Builders" }),
    isIndexMember: async () => true,
    isIndexOwner: async () => false,
  };

  return { ...base, ...overrides } as Pick<
    ChatGraphCompositeDatabase,
    "getUser" | "getProfile" | "getIndexMemberships" | "getIndex" | "isIndexMember" | "isIndexOwner"
  >;
}

describe("resolveChatContext", () => {
  test("preloads user, full profile, and named memberships", async () => {
    const db = createContextDatabase();
    const ctx = await resolveChatContext({ database: db, userId });

    expect(ctx.user.id).toBe(userId);
    expect(ctx.userProfile).not.toBeNull();
    expect(ctx.userIndexes.length).toBe(1);
    expect(ctx.userIndexes[0].indexTitle).toBe("AI Builders");
    expect(ctx.userName).toBe("Test User");
    expect(ctx.userEmail).toBe("test@example.com");
  });

  test("maps scoped membership role to member", async () => {
    const db = createContextDatabase({
      isIndexOwner: async () => false,
      isIndexMember: async () => true,
    });

    const ctx = await resolveChatContext({ database: db, userId, indexId });
    expect(ctx.scopedMembershipRole).toBe("member");
    expect(ctx.isOwner).toBe(false);
    expect(ctx.scopedIndex?.title).toBe("AI Builders");
  });

  test("maps scoped membership role to owner", async () => {
    const db = createContextDatabase({
      isIndexOwner: async () => true,
      isIndexMember: async () => true,
    });

    const ctx = await resolveChatContext({ database: db, userId, indexId });
    expect(ctx.scopedMembershipRole).toBe("owner");
    expect(ctx.isOwner).toBe(true);
  });

  test("throws when scoped index is provided for non-member", async () => {
    const db = createContextDatabase({
      isIndexMember: async () => false,
    });

    try {
      await resolveChatContext({ database: db, userId, indexId });
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ChatContextAccessError);
      const accessError = error as ChatContextAccessError;
      expect(accessError.statusCode).toBe(403);
      expect(accessError.code).toBe("INDEX_MEMBERSHIP_REQUIRED");
    }
  });
});
