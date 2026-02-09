import { ProfileDocument } from '../agents/profile.generator';
import type {
  OpportunityDetection,
  OpportunityActor,
  OpportunityInterpretation,
  OpportunityContext,
  UserSocials,
} from '../../../schemas/database.schema';

/** User record returned by getUser (minimal fields plus optional profile fields). */
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  intro?: string | null;
  avatar?: string | null;
  location?: string | null;
  socials?: UserSocials | null;
}

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
 * Member details visible to index owners (and optionally to members with privacy rules).
 */
export interface IndexMemberDetails {
  /** User ID */
  userId: string;
  /** User's display name */
  name: string;
  /** User's avatar URL */
  avatar: string | null;
  /** User's email; only present when viewer is owner/admin or the member themselves (privacy-safe) */
  email?: string | null;
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// HYDE DOCUMENT TYPES (Opportunity Redesign)
// ═══════════════════════════════════════════════════════════════════════════════

export type HydeSourceType = 'intent' | 'profile' | 'query';

export interface HydeDocument {
  id: string;
  sourceType: HydeSourceType;
  sourceId: string | null;
  sourceText: string | null;
  strategy: string;
  targetCorpus: string;
  hydeText: string;
  hydeEmbedding: number[];
  context: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface CreateHydeDocumentData {
  sourceType: HydeSourceType;
  sourceId?: string;
  sourceText?: string;
  strategy: string;
  targetCorpus: string;
  hydeText: string;
  hydeEmbedding: number[];
  context?: Record<string, unknown>;
  expiresAt?: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPPORTUNITY TYPES (Opportunity Redesign)
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  OpportunityDetection,
  OpportunityActor,
  OpportunityInterpretation,
  OpportunityContext,
  OpportunitySignal,
} from '../../../schemas/database.schema';

export type OpportunityStatus = 'latent' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';

export interface Opportunity {
  id: string;
  detection: OpportunityDetection;
  actors: OpportunityActor[];
  interpretation: OpportunityInterpretation;
  context: OpportunityContext;
  indexId: string;
  confidence: string;
  status: OpportunityStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

export interface CreateOpportunityData {
  detection: OpportunityDetection;
  actors: OpportunityActor[];
  interpretation: OpportunityInterpretation;
  context: OpportunityContext;
  indexId: string;
  confidence: string;
  status?: OpportunityStatus;
  expiresAt?: Date;
}

export interface OpportunityQueryOptions {
  status?: OpportunityStatus;
  indexId?: string;
  role?: string;
  limit?: number;
  offset?: number;
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
  getUser(userId: string): Promise<UserRecord | null>;

  /**
   * Updates user account fields (name, location, socials).
   * Merges socials with existing values (does not overwrite the whole object).
   * Used by create_user_profile tool to persist user-provided info before
   * invoking the Profile Graph in generate mode.
   *
   * @param userId - The unique identifier of the user
   * @param data - Partial user fields to update
   * @returns The updated user record or null if not found
   */
  updateUser(userId: string, data: { name?: string; location?: string; socials?: UserSocials }): Promise<UserRecord | null>;

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
   * Get index by ID (id and title only). Used for opportunity presentation.
   */
  getIndex(indexId: string): Promise<{ id: string; title: string } | null>;

  /**
   * Get index by ID with permissions (e.g. joinPolicy). Used by chat tools for create_index_membership.
   */
  getIndexWithPermissions(indexId: string): Promise<{ id: string; title: string; permissions: { joinPolicy: 'anyone' | 'invite_only' } } | null>;

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

  /**
   * Returns all index IDs that an intent is registered to.
   */
  getIndexIdsForIntent(intentId: string): Promise<string[]>;

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
   * Check if user is a member of a specific index.
   *
   * @param indexId - The index to check
   * @param userId - The user to verify membership for
   * @returns True if user is a member
   */
  isIndexMember(indexId: string, userId: string): Promise<boolean>;

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
   * Get all members of an index with their details.
   * **MEMBER ONLY** - any member of the index can list members (not just owners).
   * Returns same shape as getIndexMembersForOwner; email may be omitted for privacy.
   *
   * @param indexId - The index to get members for
   * @param requestingUserId - The user requesting (must be a member of the index)
   * @returns Array of member details with intent counts
   * @throws Error if requestingUserId is not a member of the index
   */
  getIndexMembersForMember(
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
   * Get all indexed intents for an index.
   * **MEMBER ONLY** - any member of the index can list intents (not just owners).
   *
   * @param indexId - The index to get intents for
   * @param requestingUserId - The user requesting (must be a member of the index)
   * @param options - Pagination options
   * @returns Array of intent details with owner info
   * @throws Error if requestingUserId is not a member of the index
   */
  getIndexIntentsForMember(
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

  /**
   * Soft-delete an index (set deletedAt).
   * Caller must ensure index is not personal and has no other members.
   *
   * @param indexId - The index to soft-delete
   */
  softDeleteIndex(indexId: string): Promise<void>;

  /**
   * Delete a user's profile (removes profile row).
   * Used after confirmation in chat tools.
   *
   * @param userId - User whose profile to delete
   */
  deleteProfile(userId: string): Promise<void>;

  /**
   * Get a user's profile including its row id (for update_user_profile validation).
   *
   * @param userId - The user whose profile to fetch
   * @returns Profile with id, or null if not found
   */
  getProfileByUserId(userId: string): Promise<(ProfileDocument & { id: string }) | null>;

  /**
   * Create a new index and return its record.
   *
   * @param data - Title, optional prompt, optional joinPolicy
   * @returns The created index with id, title, prompt, permissions
   */
  createIndex(data: {
    title: string;
    prompt?: string | null;
    joinPolicy?: 'anyone' | 'invite_only';
  }): Promise<{
    id: string;
    title: string;
    prompt: string | null;
    permissions: { joinPolicy: 'anyone' | 'invite_only'; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean };
  }>;

  /**
   * Count members in an index (for delete guard).
   *
   * @param indexId - The index to count
   * @returns Number of members
   */
  getIndexMemberCount(indexId: string): Promise<number>;

  /**
   * Add a user as a member of an index (replaces deprecated lib/index-members.ts).
   *
   * @param indexId - The index to add to
   * @param userId - The user to add
   * @param role - owner | admin | member
   * @returns success and optionally alreadyMember if they were already in the index
   */
  addMemberToIndex(
    indexId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member'
  ): Promise<{ success: boolean; alreadyMember?: boolean }>;

  // ─────────────────────────────────────────────────────────────────────────────
  // HyDE Document Operations (Opportunity Redesign)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a HyDE document by source and strategy.
   * Returns the first matching document when multiple target corpuses exist.
   *
   * @param sourceType - 'intent' | 'profile' | 'query'
   * @param sourceId - Source entity ID (e.g. intent ID, user ID)
   * @param strategy - Strategy name (e.g. 'mirror', 'reciprocal', 'mentor')
   * @returns The HyDE document or null if not found
   */
  getHydeDocument(
    sourceType: HydeSourceType,
    sourceId: string,
    strategy: string
  ): Promise<HydeDocument | null>;

  /**
   * Get all HyDE documents for a source (all strategies).
   *
   * @param sourceType - 'intent' | 'profile' | 'query'
   * @param sourceId - Source entity ID
   * @returns Array of HyDE documents for that source
   */
  getHydeDocumentsForSource(
    sourceType: HydeSourceType,
    sourceId: string
  ): Promise<HydeDocument[]>;

  /**
   * Save a HyDE document (upsert by sourceType + sourceId + strategy + targetCorpus).
   *
   * @param data - HyDE document data
   * @returns The saved HyDE document
   */
  saveHydeDocument(data: CreateHydeDocumentData): Promise<HydeDocument>;

  /**
   * Delete all HyDE documents for a source (e.g. when intent/profile archived).
   *
   * @param sourceType - 'intent' | 'profile' | 'query'
   * @param sourceId - Source entity ID
   * @returns Number of documents deleted
   */
  deleteHydeDocumentsForSource(
    sourceType: HydeSourceType,
    sourceId: string
  ): Promise<number>;

  /**
   * Delete expired HyDE documents (expires_at <= now). Used by maintenance jobs.
   *
   * @returns Number of documents deleted
   */
  deleteExpiredHydeDocuments(): Promise<number>;

  /**
   * Get stale HyDE documents for refresh (e.g. createdAt < threshold).
   *
   * @param threshold - Date threshold; documents created before this are considered stale
   * @returns Array of stale HyDE documents
   */
  getStaleHydeDocuments(threshold: Date): Promise<HydeDocument[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Opportunity Operations (Opportunity Redesign)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new opportunity.
   *
   * @param data - Opportunity creation data
   * @returns The created opportunity
   */
  createOpportunity(data: CreateOpportunityData): Promise<Opportunity>;

  /**
   * Get a single opportunity by ID.
   *
   * @param id - Opportunity ID
   * @returns The opportunity or null if not found
   */
  getOpportunity(id: string): Promise<Opportunity | null>;

  /**
   * Get opportunities for a user (as any actor role).
   *
   * @param userId - User ID (actor identityId)
   * @param options - Optional filters and pagination
   * @returns Array of opportunities
   */
  getOpportunitiesForUser(
    userId: string,
    options?: OpportunityQueryOptions
  ): Promise<Opportunity[]>;

  /**
   * Get opportunities in an index (for index admins).
   *
   * @param indexId - Index ID
   * @param options - Optional filters and pagination
   * @returns Array of opportunities
   */
  getOpportunitiesForIndex(
    indexId: string,
    options?: OpportunityQueryOptions
  ): Promise<Opportunity[]>;

  /**
   * Update an opportunity's status.
   *
   * @param id - Opportunity ID
   * @param status - New status
   * @returns The updated opportunity or null if not found
   */
  updateOpportunityStatus(
    id: string,
    status: OpportunityStatus
  ): Promise<Opportunity | null>;

  /**
   * Check if an opportunity already exists between the given actors in the index (deduplication).
   *
   * @param actorIds - Array of user IDs (identityIds) that would be actors
   * @param indexId - Index ID
   * @returns True if a non-expired opportunity exists with exactly these actors in this index
   */
  opportunityExistsBetweenActors(
    actorIds: string[],
    indexId: string
  ): Promise<boolean>;

  /**
   * Expire opportunities referencing an intent (e.g. when intent is archived).
   *
   * @param intentId - Intent ID to match in opportunity actors
   * @returns Number of opportunities updated to expired
   */
  expireOpportunitiesByIntent(intentId: string): Promise<number>;

  /**
   * Expire opportunities for a user removed from an index.
   *
   * @param indexId - Index ID
   * @param userId - User ID that was removed
   * @returns Number of opportunities updated to expired
   */
  expireOpportunitiesForRemovedMember(
    indexId: string,
    userId: string
  ): Promise<number>;

  /**
   * Expire opportunities whose expires_at <= now. Used by maintenance cron.
   *
   * @returns Number of opportunities updated to expired
   */
  expireStaleOpportunities(): Promise<number>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NARROWED DATABASE INTERFACES (Interface Segregation)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database interface narrowed for Profile Graph operations.
 * Provides full profile lifecycle: read, write, HyDE management, and query mode.
 */
export type ProfileGraphDatabase = Pick<
  Database,
  'getProfile' | 'getUser' | 'updateUser' | 'saveProfile' | 'saveHydeProfile' | 'getProfileByUserId' | 'saveHydeDocument'
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
  | 'updateUser'
  | 'saveProfile'
  | 'saveHydeProfile'
  // IntentGraph subgraph requirements (getActiveIntents already included)
  | 'createIntent'
  | 'updateIntent'
  | 'archiveIntent'
  // OpportunityGraph subgraph requirements (getProfile already included)
  | 'createOpportunity'
  | 'getOpportunity'
  | 'opportunityExistsBetweenActors'
  | 'getOpportunitiesForUser'
  | 'updateOpportunityStatus'
  // HyDE graph (used by OpportunityGraph)
  | 'getHydeDocument'
  | 'getHydeDocumentsForSource'
  | 'saveHydeDocument'
  | 'getIntent'
  // IndexGraph subgraph requirements (index created intents in user's indexes)
  | 'getUserIndexIds'
  | 'getIndexMemberships'
  | 'getIndex'
  | 'getIndexWithPermissions'
  | 'getIntentForIndexing'
  | 'getIndexMemberContext'
  | 'isIntentAssignedToIndex'
  | 'assignIntentToIndex'
  | 'unassignIntentFromIndex'
  | 'getIndexIdsForIntent'
  // Index Ownership Operations (owner-only)
  | 'getOwnedIndexes'
  | 'isIndexOwner'
  | 'isIndexMember'
  | 'getIndexMembersForOwner'
  | 'getIndexMembersForMember'
  | 'getIndexIntentsForOwner'
  | 'getIndexIntentsForMember'
  | 'updateIndexSettings'
  | 'softDeleteIndex'
  | 'deleteProfile'
  | 'getProfileByUserId'
  | 'createIndex'
  | 'getIndexMemberCount'
  | 'addMemberToIndex'
>;

/**
 * Database interface for Opportunity Graph operations.
 * Includes prep/scope (index membership, intents, index details), persist (create, dedupe),
 * and CRUD operations (read, update status, send).
 */
export type OpportunityGraphDatabase = Pick<
  Database,
  | 'getProfile'
  | 'createOpportunity'
  | 'opportunityExistsBetweenActors'
  | 'getUserIndexIds'
  | 'getActiveIntents'
  | 'getIndex'
  | 'getIndexMemberCount'
  // Read/update/send modes
  | 'getOpportunity'
  | 'getOpportunitiesForUser'
  | 'updateOpportunityStatus'
  | 'isIndexMember'
  | 'getUser'
>;

/**
 * Database interface for opportunity maintenance jobs.
 */
export type OpportunityMaintenanceDatabase = Pick<
  Database,
  | 'deleteExpiredHydeDocuments'
  | 'getStaleHydeDocuments'
  | 'deleteHydeDocumentsForSource'
  | 'expireOpportunitiesByIntent'
  | 'expireOpportunitiesForRemovedMember'
  | 'expireStaleOpportunities'
  | 'getIntent'
>;

/**
 * Database interface for opportunity controller (API).
 */
export type OpportunityControllerDatabase = Pick<
  Database,
  | 'getOpportunity'
  | 'getOpportunitiesForUser'
  | 'getOpportunitiesForIndex'
  | 'updateOpportunityStatus'
  | 'createOpportunity'
  | 'opportunityExistsBetweenActors'
  | 'isIndexOwner'
  | 'isIndexMember'
  | 'getUser'
  | 'getIndex'
  | 'getIndexMemberships'
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
 * Provides state population (getActiveIntents), action execution (create/update/archive),
 * and read operations (query intents; getIntentsInIndexForMember for index-scoped reads).
 */
export type IntentGraphDatabase = Pick<
  Database,
  | 'getActiveIntents'
  | 'getIntentsInIndexForMember'
  | 'createIntent'
  | 'updateIntent'
  | 'archiveIntent'
  // Read mode (queryNode) requirements
  | 'isIndexMember'
  | 'getIndexIntentsForMember'
  | 'getUser'
  // Profile check (prepNode gate for write operations)
  | 'getProfile'
>;

/**
 * Database interface narrowed for Index Graph CRUD operations.
 * Handles create, read, update, delete of indexes (communities).
 */
export type IndexGraphDatabase = Pick<
  Database,
  | 'getIndexMemberships'
  | 'getOwnedIndexes'
  | 'isIndexOwner'
  | 'isIndexMember'
  | 'getIndex'
  | 'createIndex'
  | 'addMemberToIndex'
  | 'updateIndexSettings'
  | 'softDeleteIndex'
  | 'getIndexMemberCount'
>;

/**
 * Database interface narrowed for Intent Index Graph operations.
 * Provides intent/index context and assignment for intent–index evaluation.
 * (Migrated from the old IndexGraphDatabase.)
 */
export type IntentIndexGraphDatabase = Pick<
  Database,
  | 'getIntentForIndexing'
  | 'getIndexMemberContext'
  | 'isIntentAssignedToIndex'
  | 'assignIntentToIndex'
  | 'unassignIntentFromIndex'
  | 'getIntent'
  | 'isIndexMember'
  | 'getIndexIdsForIntent'
  | 'getIndexIntentsForMember'
  | 'getIntentsInIndexForMember'
>;

/**
 * Database interface narrowed for Index Membership Graph operations.
 * Handles CRUD for index memberships (add, list, remove members).
 */
export type IndexMembershipGraphDatabase = Pick<
  Database,
  | 'isIndexMember'
  | 'isIndexOwner'
  | 'getIndexWithPermissions'
  | 'addMemberToIndex'
  | 'getIndexMembersForMember'
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

/**
 * Database interface narrowed for HyDE Graph operations.
 * Provides HyDE document CRUD and intent lookup for refresh.
 */
export type HydeGraphDatabase = Pick<
  Database,
  'getHydeDocument' | 'getHydeDocumentsForSource' | 'saveHydeDocument' | 'getIntent'
>;
