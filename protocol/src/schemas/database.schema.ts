import { pgTable, pgEnum, text, uuid, timestamp, bigint, boolean, json, jsonb, varchar, integer, uniqueIndex, index, doublePrecision } from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const connectionAction = pgEnum('connection_action', [
  'REQUEST', 'SKIP', 'CANCEL', 'ACCEPT', 'DECLINE', 'OWNER_APPROVE', 'OWNER_DENY'
]);
// Polymorphic source type for intents
export const sourceType = pgEnum('source_type', ['file', 'integration', 'link', 'discovery_form', 'enrichment']);

// Semantic Governance Enums
export const intentModeEnum = pgEnum('intent_mode', ['REFERENTIAL', 'ATTRIBUTIVE']);
export const speechActTypeEnum = pgEnum('speech_act_type', ['COMMISSIVE', 'DIRECTIVE']);
export const intentStatusEnum = pgEnum('intent_status', ['ACTIVE', 'PAUSED', 'FULFILLED', 'EXPIRED']);
export const opportunityStatusEnum = pgEnum('opportunity_status', ['PENDING', 'ACCEPTED', 'REJECTED']);
export const elaborationRequestStatusEnum = pgEnum('elaboration_request_status', ['OPEN', 'RESOLVED', 'ABANDONED']);

// Onboarding state type
export interface OnboardingState {
  completedAt?: string;  // ISO timestamp when completed
  flow?: 1 | 2 | 3;
  currentStep?: 'profile' | 'summary' | 'connections' | 'create_index' | 'invite_members' | 'join_indexes';
  indexId?: string;  // Persisted index ID for flow 2
  invitationCode?: string;  // Store which invitation was used (reference only)
}

// Social links type
export interface UserSocials {
  x?: string;  // X (formerly Twitter)
  linkedin?: string;
  github?: string;
  websites?: string[];
}

export interface NotificationPreferences {
  connectionUpdates: boolean;
  weeklyNewsletter: boolean;
}

// Directory sync configuration type
export interface DirectorySyncConfig {
  enabled: boolean;
  source: {
    id: string;       // baseId/databaseId/spreadsheetId
    name: string;
    subId?: string;   // tableId/sheetId (not used for Notion)
    subName?: string;
  };
  columnMappings: {
    email: string;
    name?: string;
    intro?: string;
    location?: string;
    twitter?: string;
    linkedin?: string;
    github?: string;
    website?: string;
  };
  excludedColumns?: string[];
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'error' | 'partial';
  lastSyncError?: string;
  memberCount?: number;
}

// Slack-specific configuration
export interface SlackConfig {
  selectedChannels?: string[]; // Array of channel IDs to sync
}

// Twitter-specific configuration
export interface TwitterConfig {
  username: string; // Twitter username extracted from URL
}

// Integration configuration type
export interface IntegrationConfigType {
  directorySync?: DirectorySyncConfig;
  slack?: SlackConfig;
  twitter?: TwitterConfig;
}

// Tables
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  privyId: text('privy_id').notNull().unique(),
  // Email is required and must be unique.
  email: text('email').notNull(),
  name: text('name').notNull(),
  intro: text('intro'),
  avatar: text('avatar'),
  location: text('location'),
  socials: json('socials').$type<UserSocials>(),
  onboarding: json('onboarding').$type<OnboardingState>().default({}),
  timezone: text('timezone').default('UTC'),
  lastWeeklyEmailSentAt: timestamp('last_weekly_email_sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => ({
  // Enforce uniqueness on all emails (email is NOT NULL).
  usersEmailUnique: uniqueIndex('users_email_unique').on(table.email),
}));

export const userProfiles = pgTable('user_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  identity: json('identity').$type<{ name: string; bio: string; location: string }>(),
  narrative: json('narrative').$type<{ context: string }>(),
  attributes: json('attributes').$type<{ interests: string[]; skills: string[] }>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // Vector embedding for semantic search (2000 dimensions for text-embedding-3-large)
  embedding: vector('embedding', { dimensions: 2000 }),
  hydeDescription: text('hyde_description'),
  hydeEmbedding: vector('hyde_embedding', { dimensions: 2000 }),
  // 3. Implicit Goals (inferred purely from profile)
  implicitIntents: json('implicit_intents'),
}, (table) => ({
  // Enforce uniqueness on userId is already done by the column definition
  embeddingIndex: index('user_profiles_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  hydeEmbeddingIndex: index('user_profiles_hyde_embedding_idx').using('hnsw', table.hydeEmbedding.op('vector_cosine_ops')),
}));

export const userNotificationSettings = pgTable('user_notification_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  preferences: json('preferences').$type<NotificationPreferences>().default({
    connectionUpdates: true,
    weeklyNewsletter: true,
  }),
  unsubscribeToken: uuid('unsubscribe_token').defaultRandom().notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const opportunities = pgTable('opportunities', {
  id: uuid('id').primaryKey().defaultRandom(),
  // References
  sourceId: uuid('source_id').notNull().references(() => users.id),
  candidateId: uuid('candidate_id').notNull().references(() => users.id),
  // Data
  score: integer('score').notNull(),
  sourceDescription: text('source_description').notNull(), // Description shown to the SOURCE user
  candidateDescription: text('candidate_description').notNull(), // Description shown to the CANDIDATE user
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // Semantic Governance
  valencyRole: text('valency_role'), // e.g., "Agent", "Patient"
  status: opportunityStatusEnum('status').default('PENDING'),
  rejectionReason: text('rejection_reason'),
})

export const intents = pgTable('intents', {
  id: uuid('id').primaryKey().defaultRandom(),
  payload: text('payload').notNull(),
  // summary field will be removed from protocol
  summary: text('summary'),
  isIncognito: boolean('is_incognito').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  archivedAt: timestamp('archived_at'),
  userId: uuid('user_id').notNull().references(() => users.id),
  // Polymorphic nullable source (file | integration | link)
  sourceId: uuid('source_id'),
  sourceType: sourceType('source_type'),
  // Vector embedding for semantic search (2000 dimensions for text-embedding-3-large)
  embedding: vector('embedding', { dimensions: 2000 }),
  // Semantic Governance Fields
  semanticEntropy: doublePrecision('semantic_entropy').default(1.0),
  referentialAnchor: text('referential_anchor'),
  intentMode: intentModeEnum('intent_mode').default('ATTRIBUTIVE'),
  speechActType: speechActTypeEnum('speech_act_type'),
  // Felicity Conditions
  felicityAuthority: integer('felicity_authority'),
  felicitySincerity: integer('felicity_sincerity'),
  status: intentStatusEnum('status').default('ACTIVE'),
}, (table) => [
  index('embeddingIndex').using('hnsw', table.embedding.op('vector_cosine_ops')),
]);

export const indexes = pgTable('indexes', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  prompt: text('prompt'), // Defines what people can share in this index
  permissions: json('permissions').$type<{
    joinPolicy: 'anyone' | 'invite_only';
    invitationLink: {
      code: string;
    } | null;
    allowGuestVibeCheck: boolean;
    requireApproval: boolean;
  }>().default({
    joinPolicy: 'invite_only',
    invitationLink: null,
    allowGuestVibeCheck: false,
    requireApproval: false
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const indexMembers = pgTable('index_members', {
  indexId: uuid('index_id').notNull().references(() => indexes.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  permissions: text('permissions').array().notNull().default([]),
  prompt: text('prompt'), // Defines what the member is sharing (defaults to index prompt)
  autoAssign: boolean('auto_assign').notNull().default(false), // Whether system auto-generates or respects manual edits
  metadata: json('metadata').$type<Record<string, string | string[]>>(), // Custom metadata for the member in this index
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  pk: { name: 'index_members_pkey', columns: [table.indexId, table.userId] }
}));

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  size: bigint('size', { mode: 'bigint' }).notNull(),
  type: text('type').notNull(),
  userId: uuid('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});


export const intentIndexes = pgTable('intent_indexes', {
  intentId: uuid('intent_id').notNull().references(() => intents.id),
  indexId: uuid('index_id').notNull().references(() => indexes.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const userConnectionEvents = pgTable('user_connection_events', {
  id: uuid('id').primaryKey().defaultRandom(),

  initiatorUserId: uuid('initiator_user_id').notNull().references(() => users.id),
  receiverUserId: uuid('receiver_user_id').notNull().references(() => users.id),

  eventType: connectionAction('connection_action').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  initiatorIdx: index('user_connection_events_initiator_idx').on(table.initiatorUserId),
  receiverIdx: index('user_connection_events_receiver_idx').on(table.receiverUserId),
  // Compound index for optimizing fetch-latest-event query
  initiatorReceiverCreatedIdx: index('initiator_receiver_created_idx').on(table.initiatorUserId, table.receiverUserId, table.createdAt),
}));

export const userIntegrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  integrationType: varchar('integration_type', { length: 50 }).notNull(),
  connectedAccountId: varchar('connected_account_id', { length: 255 }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  redirectUrl: text('redirect_url'),
  connectedAt: timestamp('connected_at'),
  lastSyncAt: timestamp('last_sync_at'),
  indexId: uuid('index_id').references(() => indexes.id), // Required for Slack/Discord (always process per user)
  config: json('config').$type<IntegrationConfigType>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at')
});

// 5. Elaboration Cycle (Interactive Intent Refinement)
// When an intent is too VAGUE (High Entropy), the system creates a request to ask the user for clarification.
export const elaborationRequests = pgTable('elaboration_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  originalUtterance: text('original_utterance').notNull(),
  missingDimensions: text('missing_dimensions').array(),
  systemPrompt: text('system_prompt').notNull(),
  status: elaborationRequestStatusEnum('status').default('OPEN'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Chat role enum for message roles
export const chatMessageRoleEnum = pgEnum('chat_message_role', ['user', 'assistant', 'system']);

// Chat Sessions table - stores persistent chat conversations
export const chatSessions = pgTable('chat_sessions', {
  id: text('id').primaryKey(), // UUID (externally provided)
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'), // Optional, can be derived from first message
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata'), // For any additional data
}, (table) => ({
  userIdx: index('chat_sessions_user_idx').on(table.userId),
}));

// Chat Messages table - stores individual messages in a chat session
export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(), // Snowflake ID (externally provided)
  sessionId: text('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: chatMessageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  routingDecision: jsonb('routing_decision'), // Store routing info
  subgraphResults: jsonb('subgraph_results'), // Store subgraph outputs
  tokenCount: integer('token_count'), // For context management
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sessionIdx: index('chat_messages_session_idx').on(table.sessionId),
}));

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  intents: many(intents),
  indexes: many(indexes),
  memberOf: many(indexMembers),
  initiatedConnections: many(userConnectionEvents, { relationName: 'initiatedConnections' }),
  receivedConnections: many(userConnectionEvents, { relationName: 'receivedConnections' }),
  notificationSettings: one(userNotificationSettings, {
    fields: [users.id],
    references: [userNotificationSettings.userId],
  }),
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
  chatSessions: many(chatSessions),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const userNotificationSettingsRelations = relations(userNotificationSettings, ({ one }) => ({
  user: one(users, {
    fields: [userNotificationSettings.userId],
    references: [users.id],
  }),
}));


export const intentsRelations = relations(intents, ({ one, many }) => ({
  user: one(users, {
    fields: [intents.userId],
    references: [users.id],
  }),
  indexes: many(intentIndexes),
  // Soft polymorphic joins (only one applies based on sourceType)
  file: one(files, {
    fields: [intents.sourceId],
    references: [files.id],
    relationName: 'intent_file',
  }),
  integration: one(userIntegrations, {
    fields: [intents.sourceId],
    references: [userIntegrations.id],
    relationName: 'intent_integration',
  }),
  link: one(indexLinks, {
    fields: [intents.sourceId],
    references: [indexLinks.id],
    relationName: 'intent_link',
  }),
}));

export const indexesRelations = relations(indexes, ({ many }) => ({
  members: many(indexMembers),
  intents: many(intentIndexes),
  integrations: many(userIntegrations),
}));


export const indexMembersRelations = relations(indexMembers, ({ one }) => ({
  index: one(indexes, {
    fields: [indexMembers.indexId],
    references: [indexes.id],
  }),
  user: one(users, {
    fields: [indexMembers.userId],
    references: [users.id],
  }),
}));

export const intentIndexesRelations = relations(intentIndexes, ({ one }) => ({
  intent: one(intents, {
    fields: [intentIndexes.intentId],
    references: [intents.id],
  }),
  index: one(indexes, {
    fields: [intentIndexes.indexId],
    references: [indexes.id],
  }),
}));

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  avatar: text('avatar').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const intentStakes = pgTable('intent_stakes', {
  id: uuid('id').primaryKey().defaultRandom(),
  intents: uuid('intents').array().notNull(), // Array of intent IDs
  stake: bigint('stake', { mode: 'bigint' }).notNull(),
  reasoning: text('reasoning').notNull(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Join table for fast stake lookups by user/intent (created by migration)
export const intentStakeItems = pgTable('intent_stake_items', {
  stakeId: uuid('stake_id').notNull(),
  intentId: uuid('intent_id').notNull(),
  userId: uuid('user_id').notNull(),
}, (table) => ({
  stakeIdx: index('intent_stake_items_stake_idx').on(table.stakeId),
  userIdx: index('intent_stake_items_user_idx').on(table.userId),
}));

export const agentsRelations = relations(agents, ({ many }) => ({
  stakes: many(intentStakes),
}));

export const intentStakesRelations = relations(intentStakes, ({ one }) => ({
  agent: one(agents, {
    fields: [intentStakes.agentId],
    references: [agents.id],
  }),
}));

// Links: manage crawlable URLs per user (optionally associated with an index)
const linksTable = pgTable('links', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  lastSyncAt: timestamp('last_sync_at'),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
// Export aliases for the links table
export const indexLinks = linksTable;
export const links = linksTable;

// Integration Items mapping (dedupe across integrations; provider='web' for crawled pages)
export type IndexLink = typeof linksTable.$inferSelect;
export type NewIndexLink = typeof linksTable.$inferInsert;

export const userConnectionEventsRelations = relations(userConnectionEvents, ({ one }) => ({
  initiatorUser: one(users, {
    fields: [userConnectionEvents.initiatorUserId],
    references: [users.id],
    relationName: 'initiatedConnections',
  }),
  receiverUser: one(users, {
    fields: [userConnectionEvents.receiverUserId],
    references: [users.id],
    relationName: 'receivedConnections',
  }),
}));

export const userIntegrationsRelations = relations(userIntegrations, ({ one }) => ({
  user: one(users, {
    fields: [userIntegrations.userId],
    references: [users.id],
  }),
  index: one(indexes, {
    fields: [userIntegrations.indexId],
    references: [indexes.id],
  }),
}));

// Chat Sessions relations
export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [chatSessions.userId],
    references: [users.id],
  }),
  messages: many(chatMessages),
}));

// Chat Messages relations
export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.sessionId],
    references: [chatSessions.id],
  }),
}));

// Export types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Intent = typeof intents.$inferSelect;
export type NewIntent = typeof intents.$inferInsert;
export type Index = typeof indexes.$inferSelect;
export type NewIndex = typeof indexes.$inferInsert;
export type IndexMember = typeof indexMembers.$inferSelect;
export type NewIndexMember = typeof indexMembers.$inferInsert;
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type IntentStake = typeof intentStakes.$inferSelect;
export type NewIntentStake = typeof intentStakes.$inferInsert;
export type UserConnectionEvent = typeof userConnectionEvents.$inferSelect;
export type NewUserConnectionEvent = typeof userConnectionEvents.$inferInsert;
export type UserIntegration = typeof userIntegrations.$inferSelect;
export type NewUserIntegration = typeof userIntegrations.$inferInsert;
export type UserNotificationSettings = typeof userNotificationSettings.$inferSelect;
export type NewUserNotificationSettings = typeof userNotificationSettings.$inferInsert;
export type ElaborationRequest = typeof elaborationRequests.$inferSelect;
export type NewElaborationRequest = typeof elaborationRequests.$inferInsert;
export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
