/**
 * Operation result types for undo-capable database operations.
 * Used by the chat graph to emit state diffs (previousState / currentState)
 * so the frontend can display change cards with undo.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SNAPSHOT TYPES (serializable subsets for before/after state)
// ═══════════════════════════════════════════════════════════════════════════════

/** Minimal index info for display on intent cards. */
export interface IntentIndexSnapshot {
  id: string;
  title: string;
}

/** Intent snapshot for operation result payloads (no embedding, no internal ids). */
export interface IntentSnapshot {
  id: string;
  payload: string;
  summary: string | null;
  isIncognito: boolean;
  archivedAt: string | null;
  /** Indexes this intent is assigned to (for list/find widgets). */
  indexes?: IntentIndexSnapshot[];
}

/** Profile snapshot for operation result payloads (identity + attributes only). */
export interface ProfileSnapshot {
  identity: { name: string; bio: string; location: string };
  narrative?: { context: string };
  attributes: { skills: string[]; interests: string[] };
}

/** Index settings snapshot for operation result payloads. */
export interface IndexSnapshot {
  id: string;
  title: string;
  prompt: string | null;
  joinPolicy: 'anyone' | 'invite_only';
  allowGuestVibeCheck: boolean;
  requireApproval: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BASE OPERATION RESULT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Represents a reversible database operation with before/after state.
 * All date fields in snapshots are serialized as ISO strings for JSON.
 */
export interface OperationResult<T = unknown> {
  /** Unique operation ID for tracking and undo. */
  operationId: string;

  /** Type of operation performed. */
  operationType: 'create' | 'update' | 'delete' | 'restore';

  /** Entity type affected. */
  entityType: 'intent' | 'profile' | 'index';

  /** Timestamp when the operation was performed (ISO string). */
  timestamp: string;

  /** State before the operation (null for create). */
  previousState: T | null;

  /** State after the operation (null for delete). */
  currentState: T | null;

  /** Whether this operation can be undone. */
  isReversible: boolean;

  /** Human-readable description of what changed. */
  description: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// READ / LIST / FIND RESULT (no undo, display-only widget)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Represents a read-only list/find operation for display in the chat widget.
 * No undo; when items are present, the frontend renders one card per item (no duplicate list in message text).
 * - entityType 'intent': items are IntentSnapshot[]
 * - entityType 'profile': items are ProfileSnapshot[] (typically one)
 * - entityType 'index': items are IndexSnapshot[]
 * - entityType 'opportunity': items are opportunity summary objects
 */
export interface ReadOperationResult {
  operationId: string;
  operationType: 'list' | 'find';
  entityType: 'intent' | 'profile' | 'index' | 'opportunity';
  timestamp: string;
  description: string;
  /** Number of items listed/found when applicable. */
  count?: number;
  /** Item snapshots for list display; when set, frontend shows one card per item. */
  items?: IntentSnapshot[] | ProfileSnapshot[] | IndexSnapshot[] | unknown[];
  isReversible: false;
  previousState: null;
  currentState: null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPED OPERATION RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

export interface IntentOperationResult extends OperationResult<IntentSnapshot> {
  entityType: 'intent';
  entityId: string;
}

export interface ProfileOperationResult extends OperationResult<ProfileSnapshot> {
  entityType: 'profile';
  entityId: string;
}

export interface IndexOperationResult extends OperationResult<IndexSnapshot> {
  entityType: 'index';
  entityId: string;
}

/** Union of all typed operation results (write + read) for streaming and API. */
export type TypedOperationResult =
  | IntentOperationResult
  | ProfileOperationResult
  | IndexOperationResult
  | ReadOperationResult;
