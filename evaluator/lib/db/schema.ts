import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const evalRunStatusEnum = pgEnum("eval_run_status", ["draft", "running", "completed"]);
export const evalScenarioStatusEnum = pgEnum("eval_scenario_status", [
  "pending",
  "running",
  "completed",
  "error",
]);

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(), // Privy user ID
    name: text("name"),
    config: jsonb("config").$type<{ maxTurns?: number; timeoutMs?: number }>(),
    status: evalRunStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("eval_runs_user_idx").on(table.userId),
  })
);

export const evalNeeds = pgTable("eval_needs", {
  id: uuid("id").primaryKey().defaultRandom(),
  needId: text("need_id").notNull().unique(),
  category: text("category").notNull(),
  question: text("question").notNull(),
  expectation: text("expectation").notNull().default(""),
  messages: jsonb("messages").$type<Record<string, string>>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userFeedback = pgTable(
  "user_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    feedback: text("feedback").notNull(),
    sessionId: text("session_id"),
    conversation: jsonb("conversation").$type<
      Array<{ role: string; content: string }>
    >(),
    retryConversation: jsonb("retry_conversation").$type<
      Array<{ role: string; content: string }>
    >(),
    retryStatus: text("retry_status").$type<
      "pending" | "running" | "completed" | "error"
    >(),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("user_feedback_user_idx").on(table.userId),
  })
);

export const evalScenarioResults = pgTable(
  "eval_scenario_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evalRunId: uuid("eval_run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    scenarioId: text("scenario_id").notNull(),
    needId: text("need_id").notNull(),
    personaId: text("persona_id").notNull(),
    category: text("category").notNull(),
    message: text("message").notNull(),
    status: evalScenarioStatusEnum("status").notNull().default("pending"),
    conversation: jsonb("conversation").$type<
      Array<{ role: "user" | "assistant"; content: string }>
    >(),
    result: jsonb("result").$type<{
      verdict: string;
      fulfillmentScore: number;
      qualityScore: number;
      reasoning: string;
      successSignals?: string[];
      failureSignals?: string[];
      turns: number;
      duration: number;
    }>(),
    reviewFlag: text("review_flag").$type<"pass" | "fail" | "needs_review" | "skipped">(),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    evalRunIdx: index("eval_scenario_results_run_idx").on(table.evalRunId),
    scenarioIdx: index("eval_scenario_results_scenario_idx").on(
      table.evalRunId,
      table.scenarioId
    ),
  })
);
