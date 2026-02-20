import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  json,
  jsonb,
  varchar,
  integer,
  doublePrecision,
  numeric,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";

// ═══════════════════════════════════════════════════════════════════════════════
// Protocol schema subset — mirrors the protocol tables we need for seeding.
// Kept in sync manually with protocol/src/schemas/database.schema.ts.
// ═══════════════════════════════════════════════════════════════════════════════

const sourceType = pgEnum("source_type", ["file", "integration", "link", "discovery_form", "enrichment"]);
const intentModeEnum = pgEnum("intent_mode", ["REFERENTIAL", "ATTRIBUTIVE"]);
const speechActTypeEnum = pgEnum("speech_act_type", ["COMMISSIVE", "DIRECTIVE"]);
const intentStatusEnum = pgEnum("intent_status", ["ACTIVE", "PAUSED", "FULFILLED", "EXPIRED"]);
const opportunityStatusEnum = pgEnum("opportunity_status", ["latent", "pending", "viewed", "accepted", "rejected", "expired"]);

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull(),
  avatar: text("avatar"),
  intro: text("intro"),
  location: text("location"),
  socials: json("socials"),
  onboarding: json("onboarding").default({}),
  timezone: text("timezone").default("UTC"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  usersEmailUnique: uniqueIndex("users_email_unique").on(table.email),
}));

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userProfiles = pgTable("user_profiles", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  identity: json("identity").$type<{ name: string; bio: string; location: string }>(),
  narrative: json("narrative").$type<{ context: string }>(),
  attributes: json("attributes").$type<{ interests: string[]; skills: string[] }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  embedding: vector("embedding", { dimensions: 2000 }),
  implicitIntents: json("implicit_intents"),
});

export const intents = pgTable("intents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  payload: text("payload").notNull(),
  summary: text("summary"),
  isIncognito: boolean("is_incognito").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  archivedAt: timestamp("archived_at"),
  userId: text("user_id").notNull().references(() => users.id),
  sourceId: text("source_id"),
  sourceType: sourceType("source_type"),
  embedding: vector("embedding", { dimensions: 2000 }),
  semanticEntropy: doublePrecision("semantic_entropy").default(1.0),
  referentialAnchor: text("referential_anchor"),
  intentMode: intentModeEnum("intent_mode").default("ATTRIBUTIVE"),
  speechActType: speechActTypeEnum("speech_act_type"),
  felicityAuthority: integer("felicity_authority"),
  felicitySincerity: integer("felicity_sincerity"),
  status: intentStatusEnum("status").default("ACTIVE"),
});

export const indexes = pgTable("indexes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  prompt: text("prompt"),
  isPersonal: boolean("is_personal").default(false).notNull(),
  permissions: json("permissions").$type<{
    joinPolicy: "anyone" | "invite_only";
    invitationLink: { code: string } | null;
    allowGuestVibeCheck: boolean;
  }>().default({
    joinPolicy: "invite_only",
    invitationLink: null,
    allowGuestVibeCheck: false,
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const indexMembers = pgTable("index_members", {
  indexId: text("index_id").notNull().references(() => indexes.id),
  userId: text("user_id").notNull().references(() => users.id),
  permissions: text("permissions").array().notNull().default([]),
  prompt: text("prompt"),
  autoAssign: boolean("auto_assign").notNull().default(false),
  metadata: json("metadata").$type<Record<string, string | string[]>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const intentIndexes = pgTable("intent_indexes", {
  intentId: text("intent_id").notNull().references(() => intents.id),
  indexId: text("index_id").notNull().references(() => indexes.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const opportunities = pgTable("opportunities", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  detection: jsonb("detection").notNull(),
  actors: jsonb("actors").notNull(),
  interpretation: jsonb("interpretation").notNull(),
  context: jsonb("context").notNull(),
  confidence: numeric("confidence").notNull(),
  status: opportunityStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Protocol schema bundle
// ═══════════════════════════════════════════════════════════════════════════════

export const protocolSchema = {
  users,
  sessions,
  accounts,
  userProfiles,
  intents,
  indexes,
  indexMembers,
  intentIndexes,
  opportunities,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Database connection
// ═══════════════════════════════════════════════════════════════════════════════

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof protocolSchema>> | null = null;

export function getProtocolDb() {
  if (_db) return _db;

  const url = process.env.PROTOCOL_DATABASE_URL;
  if (!url) {
    throw new Error("PROTOCOL_DATABASE_URL is not set");
  }

  _client = postgres(url, { prepare: false });
  _db = drizzle(_client, { schema: protocolSchema });
  return _db;
}

export type ProtocolDB = ReturnType<typeof getProtocolDb>;
