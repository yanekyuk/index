import { ProfileDocument } from '../agents/profile/profile.generator';

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Minimal intent representation used for graph state population.
 * Contains only the fields needed for reconciliation logic.
 */
export interface ActiveIntent {
  /** Unique identifier of the intent */
  id: string;
  /** Full intent description/payload */
  payload: string;
  /** Short summary of the intent (may be null if not generated) */
  summary: string | null;
  /** When the intent was created */
  createdAt: Date;
}

/**
 * Input data for creating a new intent.
 * Supports the full intent pipeline including embedding and index association.
 */
export interface CreateIntentData {
  /** The user who owns this intent */
  userId: string;
  /** Full intent description/payload */
  payload: string;
  /** Pre-computed summary (optional, will be generated if not provided) */
  summary?: string | null;
  /** Pre-computed embedding vector (optional, will be generated if not provided) */
  embedding?: number[];
  /** Whether the intent should be hidden from public views */
  isIncognito?: boolean;
  /** Index IDs to associate with (optional, uses dynamic scoping if empty) */
  indexIds?: string[];
  /** Source type for provenance tracking */
  sourceType?: 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment';
  /** Source ID for provenance tracking */
  sourceId?: string;
  /** Confidence score from inference (0-1, required) */
  confidence: number;
  /** How the intent was inferred */
  inferenceType: 'explicit' | 'implicit';
}

/**
 * Input data for updating an existing intent.
 * All fields are optional - only provided fields will be updated.
 */
export interface UpdateIntentData {
  /** Updated intent description/payload */
  payload?: string;
  /** Updated summary */
  summary?: string | null;
  /** Updated embedding vector */
  embedding?: number[];
  /** Updated incognito status */
  isIncognito?: boolean;
  /** Updated index associations (replaces existing) */
  indexIds?: string[];
}

/**
 * The result of a successful intent creation.
 * Contains the core fields needed for immediate use.
 */
export interface CreatedIntent {
  /** Unique identifier of the created intent */
  id: string;
  /** Full intent description/payload */
  payload: string;
  /** Generated or provided summary */
  summary: string | null;
  /** Incognito status */
  isIncognito: boolean;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Owner user ID */
  userId: string;
}

/**
 * Full intent record with all fields (for detailed queries).
 */
export interface IntentRecord extends CreatedIntent {
  /** Archival timestamp (null if active) */
  archivedAt: Date | null;
  /** Embedding vector (may be null) */
  embedding?: number[] | null;
  /** Source type for provenance */
  sourceType?: string | null;
  /** Source ID for provenance */
  sourceId?: string | null;
}

/**
 * Intent with similarity score from vector search.
 */
export interface SimilarIntent extends IntentRecord {
  /** Cosine similarity score (0-1) */
  similarity: number;
}

/**
 * Result of an archive operation.
 */
export interface ArchiveResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Options for vector similarity search.
 */
export interface SimilarIntentSearchOptions {
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Minimum similarity threshold (default: 0.7) */
  threshold?: number;
}

/**
 * Represents a user's membership in an index with full details.
 * Used for displaying index memberships in chat (index_query).
 */
export interface IndexMembership {
  /** Unique identifier of the index */
  indexId: string;
  /** Display title of the index */
  indexTitle: string;
  /** Index description/prompt (what the community is about) */
  indexPrompt: string | null;
  /** Member's permissions in this index */
  permissions: string[];
  /** Member's custom prompt (overrides index prompt for their intents) */
  memberPrompt: string | null;
  /** Whether new intents are auto-assigned to this index */
  autoAssign: boolean;
  /** When the user joined the index */
  joinedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDEX OWNERSHIP TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Represents an index owned by the user with full details.
 */
export interface OwnedIndex {
  /** Index ID */
  id: string;
  /** Display title */
  title: string;
  /** Index purpose/scope prompt */
  prompt: string | null;
  /** Permission settings */
  permissions: {
    joinPolicy: 'anyone' | 'invite_only';
    allowGuestVibeCheck: boolean;
    requireApproval: boolean;
    invitationLink: { code: string } | null;
  };
  /** When the index was created */
  createdAt: Date;
  /** Member count */
  memberCount: number;
  /** Total intents indexed */
  intentCount: number;
}

/**
 * Member details visible to index owners.
 */
export interface IndexMemberDetails {
  /** User ID */
  userId: string;
  /** User's display name */
  name: string;
  /** User's avatar URL */
  avatar: string | null;
  /** User's email */
  email: string;
  /** Member's permissions in this index */
  permissions: string[];
  /** Member's custom prompt */
  memberPrompt: string | null;
  /** Whether auto-assign is enabled */
  autoAssign: boolean;
  /** When they joined */
  joinedAt: Date;
  /** Count of their intents in this index */
  intentCount: number;
}

/**
 * Intent details visible to index owners.
 */
export interface IndexedIntentDetails {
  /** Intent ID */
  id: string;
  /** Intent payload/description */
  payload: string;
  /** Intent summary */
  summary: string | null;
  /** Owner's user ID */
  userId: string;
  /** Owner's name */
  userName: string;
  /** When the intent was created */
  createdAt: Date;
}

/**
 * Options for updating index settings.
 */
export interface UpdateIndexSettingsData {
  /** New title (optional) */
  title?: string;
  /** New prompt (optional) */
  prompt?: string | null;
  /** New join policy (optional) */
  joinPolicy?: 'anyone' | 'invite_only';
  /** Allow guest vibe check (optional) */
  allowGuestVibeCheck?: boolean;
  /** Require approval for new members (optional) */
  requireApproval?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Abstract database interface for performing specific domain operations.
 * Decouples the protocol layer from the infrastructure layer.
 */
export interface Database {
  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Operations (Preserved)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Retrieves a user profile by userId.
   * @param userId - The unique identifier of the user
   * @returns The user's profile or null if not found
   */
  getProfile(userId: string): Promise<ProfileDocument | null>;

  /**
   * Creates or updates a user profile.
   * @param userId - The unique identifier of the user
   * @param profile - The profile data to save
   */
  saveProfile(userId: string, profile: ProfileDocument): Promise<void>;

  /**
   * Updates the HyDE (Hypothetical Document Embedding) fields for a user profile.
   * @param userId - The unique identifier of the user
   * @param description - The generated HyDE description
   * @param embedding - The vector embedding of the description
   */
  saveHydeProfile(userId: string, description: string, embedding: number[]): Promise<void>;

  /**
   * Retrieves basic user information (name, email, socials) by userId.
   * @param userId - The unique identifier of the user
   * @returns The user record or null if not found
   */
  getUser(userId: string): Promise<any | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Pre-Graph Operations (State Population)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Retrieves all active (non-archived) intents for a user.
   * Used to populate the `activeIntents` field in the Intent Graph state
   * before graph execution.
   *
   * @param userId - The unique identifier of the user
   * @returns Array of active intents with minimal fields needed for reconciliation
   *
   * @example
   * ```typescript
   * const activeIntents = await db.getActiveIntents(userId);
   * const formattedIntents = activeIntents
   *   .map(i => `ID: ${i.id}, Description: ${i.payload}, Summary: ${i.summary || 'N/A'}`)
   *   .join('\n');
   * ```
   */
  getActiveIntents(userId: string): Promise<ActiveIntent[]>;

  /**
   * Get active intents that belong to the user and are assigned to a specific index.
   * Caller must be a member of that index; only the user's own intents are returned.
   *
   * @param userId - The user requesting (must be a member of the index)
   * @param indexNameOrId - Index UUID or display name (e.g. "Open Mock Network")
   * @returns Array of active intents in that index for the user, or empty if not a member / no match
   */
  getIntentsInIndexForMember(userId: string, indexNameOrId: string): Promise<ActiveIntent[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Post-Graph Operations (Action Execution)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Creates a new intent with full processing pipeline.
   * Handles summarization, embedding generation, and index association.
   *
   * Called when the reconciler outputs a "create" action.
   *
   * @param data - The intent creation data
   * @returns The created intent with generated fields
   *
   * @example
   * ```typescript
   * // After graph outputs CREATE action
   * const newIntent = await db.createIntent({
   *   userId,
   *   payload: action.payload,
   *   confidence: action.score / 100,
   *   inferenceType: 'explicit',
   *   sourceType: 'discovery_form'
   * });
   * ```
   */
  createIntent(data: CreateIntentData): Promise<CreatedIntent>;

  /**
   * Updates an existing intent.
   * Re-generates summary and embedding if payload changes.
   *
   * Called when the reconciler outputs an "update" action.
   *
   * @param intentId - The unique identifier of the intent to update
   * @param data - The fields to update
   * @returns The updated intent or null if not found
   * @throws Error if the intent exists but user doesn't have access
   *
   * @example
   * ```typescript
   * // After graph outputs UPDATE action
   * const updated = await db.updateIntent(action.id, {
   *   payload: action.payload
   * });
   * ```
   */
  updateIntent(intentId: string, data: UpdateIntentData): Promise<CreatedIntent | null>;

  /**
   * Archives (soft-deletes) an intent.
   * Sets the archivedAt timestamp rather than hard deleting.
   *
   * Called when the reconciler outputs an "expire" action.
   *
   * @param intentId - The unique identifier of the intent to archive
   * @returns Result object indicating success or failure with error message
   *
   * @example
   * ```typescript
   * // After graph outputs EXPIRE action
   * const result = await db.archiveIntent(action.id);
   * if (!result.success) {
   *   console.error(`Failed to archive: ${result.error}`);
   * }
   * ```
   */
  archiveIntent(intentId: string): Promise<ArchiveResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Retrieves a single intent by ID.
   *
   * @param intentId - The unique identifier of the intent
   * @returns The full intent record or null if not found
   */
  getIntent(intentId: string): Promise<IntentRecord | null>;

  /**
   * Retrieves an intent with ownership verification.
   * Ensures the requesting user owns the intent before returning.
   *
   * Used for processing operations (refine, suggestions) that require ownership.
   *
   * @param intentId - The unique identifier of the intent
   * @param userId - The user requesting access
   * @returns The intent if found and owned by user, null if not found
   * @throws Error with message 'Access denied' if intent exists but is not owned by user
   *
   * @example
   * ```typescript
   * try {
   *   const intent = await db.getIntentWithOwnership(intentId, userId);
   *   if (!intent) return res.status(404).json({ error: 'Not found' });
   *   // Process intent...
   * } catch (e) {
   *   if (e.message === 'Access denied') {
   *     return res.status(403).json({ error: 'Forbidden' });
   *   }
   *   throw e;
   * }
   * ```
   */
  getIntentWithOwnership(intentId: string, userId: string): Promise<IntentRecord | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Association Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Gets Index IDs where the user has auto-assign membership enabled.
   * Used for determining which indexes to associate new intents with.
   *
   * @param userId - The unique identifier of the user
   * @returns Array of index IDs
   *
   * @example
   * ```typescript
   * const indexIds = await db.getUserIndexIds(userId);
   * if (indexIds.length > 0) {
   *   await db.associateIntentWithIndexes(intentId, indexIds);
   * }
   * ```
   */
  getUserIndexIds(userId: string): Promise<string[]>;

  /**
   * Retrieves all indexes the user is a member of with full details.
   * Used for displaying index memberships in chat (index_query).
   *
   * @param userId - The unique identifier of the user
   * @returns Array of index memberships with details
   */
  getIndexMemberships(userId: string): Promise<IndexMembership[]>;

  /**
   * Associates an intent with one or more indexes.
   * Creates entries in the intentIndexes join table.
   *
   * @param intentId - The intent to associate
   * @param indexIds - Array of index IDs to associate with
   *
   * @example
   * ```typescript
   * await db.associateIntentWithIndexes(intentId, ['idx_1', 'idx_2']);
   * ```
   */
  associateIntentWithIndexes(intentId: string, indexIds: string[]): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Vector Search Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Finds semantically similar intents using vector search.
   * Used for deduplication during intent creation and discovery.
   *
   * Privacy scoping: Results are always filtered by userId to ensure
   * users only see their own intents.
   *
   * @param embedding - The query embedding vector
   * @param userId - The user ID for privacy scoping (required)
   * @param options - Search options (limit, threshold)
   * @returns Array of intents with similarity scores, sorted by similarity
   *
   * @example
   * ```typescript
   * // Check for duplicates before creating
   * const embedding = await embedder.generate(payload);
   * const similar = await db.findSimilarIntents(embedding, userId, {
   *   limit: 5,
   *   threshold: 0.85
   * });
   * if (similar.length > 0 && similar[0].similarity > 0.95) {
   *   // Likely duplicate - consider updating instead
   * }
   * ```
   */
  findSimilarIntents(
    embedding: number[],
    userId: string,
    options?: SimilarIntentSearchOptions
  ): Promise<SimilarIntent[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Graph Operations (Intent–Index Assignment)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Intent fields needed for index appropriateness evaluation.
   */
  getIntentForIndexing(intentId: string): Promise<{
    id: string;
    payload: string;
    userId: string;
    sourceType: string | null;
    sourceId: string | null;
  } | null>;

  /**
   * Index + member prompts for a user in an index (only when member has autoAssign).
   * Returns null if user is not a member or autoAssign is false.
   */
  getIndexMemberContext(
    indexId: string,
    userId: string
  ): Promise<{
    indexId: string;
    indexPrompt: string | null;
    memberPrompt: string | null;
  } | null>;

  /**
   * Whether the intent is currently assigned to the index.
   */
  isIntentAssignedToIndex(intentId: string, indexId: string): Promise<boolean>;

  /**
   * Assigns an intent to an index (inserts intent_indexes row).
   */
  assignIntentToIndex(intentId: string, indexId: string): Promise<void>;

  /**
   * Removes an intent from an index (deletes intent_indexes row).
   */
  unassignIntentFromIndex(intentId: string, indexId: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Ownership Operations (Owner-Only)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get indexes where the user has owner permissions.
   * Returns full index details with member and intent counts.
   *
   * @param userId - The user ID to check ownership for
   * @returns Array of owned indexes with counts
   */
  getOwnedIndexes(userId: string): Promise<OwnedIndex[]>;

  /**
   * Check if user is an owner of a specific index.
   *
   * @param indexId - The index to check
   * @param userId - The user to verify ownership for
   * @returns True if user is an owner
   */
  isIndexOwner(indexId: string, userId: string): Promise<boolean>;

  /**
   * Get all members of an index with their details.
   * **OWNER ONLY** - throws if user is not an owner.
   *
   * @param indexId - The index to get members for
   * @param requestingUserId - The user requesting (must be owner)
   * @returns Array of member details with intent counts
   * @throws Error if requestingUserId is not an owner
   */
  getIndexMembersForOwner(
    indexId: string,
    requestingUserId: string
  ): Promise<IndexMemberDetails[]>;

  /**
   * Get all indexed intents for an index.
   * **OWNER ONLY** - throws if user is not an owner.
   *
   * @param indexId - The index to get intents for
   * @param requestingUserId - The user requesting (must be owner)
   * @param options - Pagination options
   * @returns Array of intent details with owner info
   * @throws Error if requestingUserId is not an owner
   */
  getIndexIntentsForOwner(
    indexId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<IndexedIntentDetails[]>;

  /**
   * Update index settings.
   * **OWNER ONLY** - throws if user is not an owner.
   *
   * @param indexId - The index to update
   * @param requestingUserId - The user requesting (must be owner)
   * @param data - The settings to update
   * @returns The updated index
   * @throws Error if requestingUserId is not an owner
   */
  updateIndexSettings(
    indexId: string,
    requestingUserId: string,
    data: UpdateIndexSettingsData
  ): Promise<OwnedIndex>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NARROWED DATABASE INTERFACES (Interface Segregation)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database interface narrowed for Profile Graph operations.
 * Provides full profile lifecycle: read, write, and HyDE management.
 */
export type ProfileGraphDatabase = Pick<
  Database,
  'getProfile' | 'getUser' | 'saveProfile' | 'saveHydeProfile'
>;

/**
 * Database interface narrowed for Chat Graph operations.
 * Read-only context loading for conversation handling.
 */
export type ChatGraphDatabase = Pick<
  Database,
  'getProfile' | 'getActiveIntents'
>;

/**
 * Composite database interface for Chat Graph.
 * Includes direct ChatGraph operations plus all methods needed by
 * internally composed subgraphs (ProfileGraph, OpportunityGraph, IntentGraph, IndexGraph).
 *
 * Use this type when ChatGraph orchestrates subgraphs internally.
 * For direct ChatGraph operations only, use ChatGraphDatabase.
 */
export type ChatGraphCompositeDatabase = Pick<
  Database,
  // Direct ChatGraph operations
  | 'getProfile'
  | 'getActiveIntents'
  | 'getIntentsInIndexForMember'
  // ProfileGraph subgraph requirements
  | 'getUser'
  | 'saveProfile'
  | 'saveHydeProfile'
  // IntentGraph subgraph requirements (getActiveIntents already included)
  | 'createIntent'
  | 'updateIntent'
  | 'archiveIntent'
  // OpportunityGraph subgraph requirements (getProfile already included)
  // IndexGraph subgraph requirements (index created intents in user's indexes)
  | 'getUserIndexIds'
  | 'getIndexMemberships'
  | 'getIntentForIndexing'
  | 'getIndexMemberContext'
  | 'isIntentAssignedToIndex'
  | 'assignIntentToIndex'
  | 'unassignIntentFromIndex'
  // Index Ownership Operations (owner-only)
  | 'getOwnedIndexes'
  | 'isIndexOwner'
  | 'getIndexMembersForOwner'
  | 'getIndexIntentsForOwner'
  | 'updateIndexSettings'
>;

/**
 * Database interface narrowed for Opportunity Graph operations.
 * Minimal profile lookup for opportunity evaluation.
 */
export type OpportunityGraphDatabase = Pick<
  Database,
  'getProfile'
>;

/**
 * Database interface for Intent action execution (post-graph processing).
 * Used by controllers to execute intent CRUD, query, and vector operations
 * based on Intent Graph output actions.
 */
export type IntentExecutorDatabase = Pick<
  Database,
  | 'createIntent'
  | 'updateIntent'
  | 'archiveIntent'
  | 'getIntent'
  | 'getIntentWithOwnership'
  | 'getActiveIntents'
  | 'getUserIndexIds'
  | 'associateIntentWithIndexes'
  | 'findSimilarIntents'
>;

/**
 * Database interface narrowed for Intent Graph operations.
 * Provides state population (getActiveIntents) and action execution (create/update/archive).
 */
export type IntentGraphDatabase = Pick<
  Database,
  'getActiveIntents' | 'createIntent' | 'updateIntent' | 'archiveIntent'
>;

/**
 * Database interface narrowed for Index Graph operations.
 * Provides intent/index context and assignment for intent–index evaluation.
 */
export type IndexGraphDatabase = Pick<
  Database,
  | 'getIntentForIndexing'
  | 'getIndexMemberContext'
  | 'isIntentAssignedToIndex'
  | 'assignIntentToIndex'
  | 'unassignIntentFromIndex'
>;

/**
 * Database interface for Index Ownership operations.
 * Used by chat graph for owner-specific index management.
 */
export type IndexOwnershipDatabase = Pick<
  Database,
  | 'getOwnedIndexes'
  | 'isIndexOwner'
  | 'getIndexMembersForOwner'
  | 'getIndexIntentsForOwner'
  | 'updateIndexSettings'
  | 'getIndexMemberships'
>;
