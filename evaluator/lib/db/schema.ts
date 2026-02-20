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
import type { SeedRequirement, GeneratedSeedData } from "../seed/seed.types";

// ═══════════════════════════════════════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════════════════════════════════════

export const evalRunStatusEnum = pgEnum("eval_run_status", ["draft", "running", "completed"]);
export const evalScenarioStatusEnum = pgEnum("eval_scenario_status", [
  "pending",
  "running",
  "completed",
  "error",
]);
export const evalScenarioSourceEnum = pgEnum("eval_scenario_source", [
  "predefined",
  "feedback",
  "generated",
]);

// ═══════════════════════════════════════════════════════════════════════════════
// eval_scenarios — all test cases, any source
// ═══════════════════════════════════════════════════════════════════════════════

export const evalScenarios = pgTable(
  "eval_scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: evalScenarioSourceEnum("source").notNull(),

    category: text("category").notNull(),
    needId: text("need_id"),

    question: text("question").notNull(),
    expectation: text("expectation").notNull(),
    message: text("message").notNull(),
    personaId: text("persona_id"),

    feedbackText: text("feedback_text"),
    feedbackConversation: jsonb("feedback_conversation").$type<
      Array<{ role: string; content: string }>
    >(),

    seedRequirements: jsonb("seed_requirements").$type<SeedRequirement>(),

    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    categoryIdx: index("eval_scenarios_category_idx").on(table.category),
    sourceIdx: index("eval_scenarios_source_idx").on(table.source),
  })
);

// ═══════════════════════════════════════════════════════════════════════════════
// eval_runs — execution batches
// ═══════════════════════════════════════════════════════════════════════════════

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
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

// ═══════════════════════════════════════════════════════════════════════════════
// eval_run_results — per-scenario execution results
// ═══════════════════════════════════════════════════════════════════════════════

export const evalRunResults = pgTable(
  "eval_run_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evalRunId: uuid("eval_run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => evalScenarios.id),
    status: evalScenarioStatusEnum("status").notNull().default("pending"),

    seedData: jsonb("seed_data").$type<GeneratedSeedData>(),

    conversation: jsonb("conversation").$type<
      Array<{ role: "user" | "assistant"; content: string }>
    >(),

    result: jsonb("result").$type<{
      verdict: "success" | "partial" | "failure" | "blocked";
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
    evalRunIdx: index("eval_run_results_run_idx").on(table.evalRunId),
    scenarioIdx: index("eval_run_results_scenario_idx").on(
      table.evalRunId,
      table.scenarioId
    ),
  })
);
