# Index Ownership: Chat Interface Implementation Plan

**Status:** Planning  
**Date:** 2026-02-01  
**Related:** [Chat Graph](../protocol/src/lib/protocol/graphs/chat/chat.graph.ts), [Index Graph](../protocol/src/lib/protocol/graphs/index/index.graph.ts), [Index Access](../protocol/src/lib/index-access.ts)

---

## Executive Summary

This plan details how to enable **index owners** to manage their indexes through the chat interface. Owners should be able to:

1. View indexes they own
2. Update index settings (title, prompt, permissions)
3. List all members and their indexed intents
4. Manage member permissions

**Critical Access Control Rule:** Members can only see their own intents within an index. Only owners can see all members and all indexed intents.

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Proposed Architecture](#2-proposed-architecture)
3. [Database Interface Extensions](#3-database-interface-extensions)
4. [Router Agent Updates](#4-router-agent-updates)
5. [Chat Graph Updates](#5-chat-graph-updates)
6. [Index Graph Enhancements](#6-index-graph-enhancements)
7. [Access Control Implementation](#7-access-control-implementation)
8. [Implementation Phases](#8-implementation-phases)
9. [Testing Strategy](#9-testing-strategy)

---

## 1. Current State Analysis

### 1.1 Ownership Model

Ownership is determined by the `permissions` array in `indexMembers` table:

```sql
-- User is owner if 'owner' is in the permissions array
WHERE 'owner' = ANY(index_members.permissions)
```

**Roles:**
| Role | Permissions Array | Capabilities |
|------|------------------|--------------|
| `owner` | `['owner']` | Full control: settings, members, view all intents |
| `admin` | `['admin', 'member']` | Manage members (add/remove), cannot promote to owner |
| `member` | `['member']` | View own intents, manage own index membership |

### 1.2 Current Chat Routes

| Route Target | Type | Current Capability |
|--------------|------|-------------------|
| `index_query` | Read | Returns user's index **memberships** (not ownership details) |
| ❌ `index_write` | Write | **Does not exist** |

### 1.3 Current API Endpoints (for reference)

| Endpoint | Access | Owner-Only |
|----------|--------|-----------|
| `PUT /indexes/:id` | Owner | ✓ Update title, prompt, permissions |
| `PATCH /indexes/:id/permissions` | Owner | ✓ Update joinPolicy, allowGuestVibeCheck |
| `GET /indexes/:id/members` | Member | ✗ Any member can view |
| `GET /indexes/:id/intents` | Member | ✗ Any member can view **all** intents |
| `GET /indexes/:id/summary` | Owner | ✓ Owner-only summary view |

**Issue:** The current `GET /indexes/:id/intents` endpoint exposes all indexed intents to any member. This needs to be fixed as part of this implementation.

---

## 2. Proposed Architecture

### 2.1 New Route Targets

```typescript
// Router targets to add
"index_owner_query"    // Owner-only read: view full index details, all members, all intents
"index_write"          // Owner-only write: update settings, manage members
```

**Alternative (Simpler):** Extend `index_query` with ownership detection:
- If user is owner → return full ownership view
- If user is member → return membership view (current behavior)

### 2.2 Decision: Extend `index_query` vs. New Routes

| Approach | Pros | Cons |
|----------|------|------|
| **Extend `index_query`** | Simpler router logic, natural UX ("show my indexes" reveals ownership info) | Mixes read concerns |
| **Separate `index_owner_query`** | Clear separation, explicit intent detection | More complex routing |
| **Add `index_write`** | Needed for settings changes | Required regardless |

**Recommendation:** 
1. Extend `index_query` to include ownership information
2. Add `index_write` for modification operations

### 2.3 High-Level Flow

```
User: "Show me the members of my AI Founders index"
          │
          ▼
    ┌───────────┐
    │  Router   │ ──▶ Detects: index ownership query
    └─────┬─────┘     Target: index_query
          │           extractedContext: "AI Founders"
          ▼
    ┌───────────────┐
    │  load_context │
    └───────┬───────┘
            ▼
    ┌───────────────┐
    │  index_query  │ ──▶ Check ownership
    │  (enhanced)   │     If owner: return full member list + intents
    └───────┬───────┘     If not owner: return limited view
            │
            ▼
    ┌───────────────────┐
    │ generate_response │
    └───────────────────┘
```

---

## 3. Database Interface Extensions

### 3.1 New Types

Add to `protocol/src/lib/protocol/interfaces/database.interface.ts`:

```typescript
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
```

### 3.2 New Database Methods

Add to the `Database` interface:

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// Index Ownership Operations
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
```

### 3.3 Updated Narrowed Interface

Add a new composite interface for index ownership operations:

```typescript
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
  | 'getIndexMemberships' // existing - for non-owners
>;
```

Update `ChatGraphCompositeDatabase` to include the new methods:

```typescript
export type ChatGraphCompositeDatabase = Pick<
  Database,
  // ... existing ...
  // Index Ownership Operations (NEW)
  | 'getOwnedIndexes'
  | 'isIndexOwner'
  | 'getIndexMembersForOwner'
  | 'getIndexIntentsForOwner'
  | 'updateIndexSettings'
>;
```

---

## 4. Router Agent Updates

### 4.1 Update System Prompt

Add to `chat.router.ts` system prompt:

```typescript
### index_query (ENHANCED)
**Type:** Read-only

**What it does:** Fetches the user's index information. Behavior varies by ownership:
- **If owner:** Returns full index details including all members and their intents
- **If member:** Returns membership information only

**When to use:**
- User asks about their indexes/communities
- User asks to see members of an index (owner context)
- User asks what intents are in their index (owner context)
- User asks "who's in my index?"

**Examples:**
- "show my indexes" → list all memberships + owned indexes
- "who are the members of my AI Founders index?" → owner query for specific index
- "what intents are in my networking community?" → owner query for intents
- "show me what John has shared in my index" → owner query for member intents

**Config:** 
- operationType: "read"
- extractedContext: Index name/identifier if querying specific index

---

### index_write
**Type:** Write (owner-only)

**What it does:** Updates index settings. Only available to index owners.

**When to use:**
- User wants to change index title
- User wants to update index prompt/description
- User wants to change privacy settings (public/private)
- User wants to update member permissions

**Examples:**
- "change my index title to 'AI Builders'" → update title
- "make my index private" → update joinPolicy
- "update the prompt of my Founders index to..." → update prompt
- "enable guest vibe check for my index" → update settings

**Config:**
- operationType: "update"
- extractedContext: The changes to apply (title, prompt, settings)
```

### 4.2 Update Route Targets

Add `index_write` to the routing schema:

```typescript
target: z.enum([
  "intent_query",
  "intent_write",
  "profile_query",
  "profile_write",
  "index_query",          // Enhanced with ownership context
  "index_write",          // NEW: Owner-only write operations
  "opportunity_subgraph",
  "scrape_web",
  "respond",
  "clarify"
])
```

---

## 5. Chat Graph Updates

### 5.1 Enhanced Index Query Node

Update `indexQueryNode` in `chat.graph.ts`:

```typescript
const indexQueryNode = async (state: typeof ChatGraphState.State) => {
  logger.info("🚀 Index query: Checking ownership context...");

  try {
    // Get user's index memberships
    const memberships = await this.database.getIndexMemberships(state.userId);
    
    // Get indexes user owns
    const ownedIndexes = await this.database.getOwnedIndexes(state.userId);
    
    // Check if user is asking about a specific index
    const extractedContext = state.routingDecision?.extractedContext;
    
    let specificIndexData = null;
    if (extractedContext) {
      // Try to find the index by name/title
      const matchedIndex = ownedIndexes.find(idx => 
        idx.title.toLowerCase().includes(extractedContext.toLowerCase())
      );
      
      if (matchedIndex) {
        // User owns this index - get full details
        const [members, intents] = await Promise.all([
          this.database.getIndexMembersForOwner(matchedIndex.id, state.userId),
          this.database.getIndexIntentsForOwner(matchedIndex.id, state.userId, { limit: 20 })
        ]);
        
        specificIndexData = {
          index: matchedIndex,
          members,
          intents,
          isOwner: true
        };
        
        logger.info("✅ Owner access granted for specific index", {
          indexId: matchedIndex.id,
          memberCount: members.length,
          intentCount: intents.length
        });
      } else {
        // Check if user is a member (not owner) of this index
        const membershipMatch = memberships.find(m =>
          m.indexTitle.toLowerCase().includes(extractedContext.toLowerCase())
        );
        
        if (membershipMatch) {
          specificIndexData = {
            index: membershipMatch,
            isOwner: false,
            accessDeniedMessage: "You are a member of this index but not an owner. " +
              "You can only view your own indexed intents. Ask the owner for full access."
          };
        }
      }
    }

    logger.info("✅ Index query complete", {
      membershipCount: memberships.length,
      ownedCount: ownedIndexes.length,
      hasSpecificQuery: !!specificIndexData
    });

    const subgraphResults: SubgraphResults = {
      index: {
        mode: 'query',
        memberships,
        ownedIndexes,
        specificIndexData,
        count: memberships.length
      }
    };

    return { subgraphResults };
  } catch (error) {
    logger.error("Query failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      subgraphResults: {
        index: {
          mode: 'query',
          memberships: [],
          ownedIndexes: [],
          count: 0,
          error: 'Failed to fetch index information'
        }
      },
      error: "Index query failed"
    };
  }
};
```

### 5.2 New Index Write Node

Add new node for owner operations:

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// NODE: Index Write (Owner-Only Operations)
// Updates index settings, manages members.
// Fast path for owner-initiated changes.
// ─────────────────────────────────────────────────────────────────────────────
const indexWriteNode = async (state: typeof ChatGraphState.State) => {
  logger.info("📝 Index write: Processing owner operation...");

  const operationType = state.routingDecision?.operationType;
  const extractedContext = state.routingDecision?.extractedContext;

  if (!extractedContext) {
    return {
      subgraphResults: {
        index: {
          mode: 'write',
          success: false,
          error: 'No index or changes specified'
        }
      },
      error: "Missing context for index update"
    };
  }

  try {
    // Parse the extracted context for index identification and changes
    // The router should have structured this as: "indexName: changes" or similar
    const { indexId, changes } = await this.parseIndexWriteContext(
      extractedContext, 
      state.userId
    );

    if (!indexId) {
      return {
        subgraphResults: {
          index: {
            mode: 'write',
            success: false,
            error: 'Could not identify which index to update. Please specify the index name.'
          }
        }
      };
    }

    // Verify ownership
    const isOwner = await this.database.isIndexOwner(indexId, state.userId);
    if (!isOwner) {
      logger.warn("⛔ Access denied: User is not owner", {
        userId: state.userId,
        indexId
      });
      return {
        subgraphResults: {
          index: {
            mode: 'write',
            success: false,
            error: 'Access denied. You must be an owner of this index to modify it.'
          }
        }
      };
    }

    // Apply the changes
    const updatedIndex = await this.database.updateIndexSettings(
      indexId,
      state.userId,
      changes
    );

    logger.info("✅ Index updated successfully", {
      indexId,
      changes: Object.keys(changes)
    });

    return {
      subgraphResults: {
        index: {
          mode: 'write',
          success: true,
          updatedIndex,
          changesApplied: Object.keys(changes)
        }
      }
    };
  } catch (error) {
    logger.error("Index write failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      subgraphResults: {
        index: {
          mode: 'write',
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update index'
        }
      },
      error: "Index write failed"
    };
  }
};
```

### 5.3 Update Graph Assembly

Add the new node and routing:

```typescript
const workflow = new StateGraph(ChatGraphState)
  // ... existing nodes ...
  .addNode("index_write", indexWriteNode)  // NEW

  // ... existing edges ...

  // Update routing condition to include index_write
  .addConditionalEdges("load_context", routeCondition, {
    // ... existing ...
    index_query: "index_query",
    index_write: "index_write",  // NEW
    // ...
  })

  // New edge from index_write to response
  .addEdge("index_write", "generate_response");
```

---

## 6. Index Graph Enhancements

### 6.1 Current Index Graph

The current `IndexGraphFactory` handles intent-to-index assignment evaluation. It does NOT need modification for ownership features, as those are handled at the chat graph level.

### 6.2 Optional: Admin Operations Graph

If we need complex multi-step owner operations in the future (e.g., bulk member management), we could create an `IndexAdminGraph`:

```typescript
// Future consideration - NOT part of initial implementation
export class IndexAdminGraphFactory {
  constructor(private database: IndexOwnershipDatabase) {}
  
  // Operations:
  // - Bulk member permission updates
  // - Index migration
  // - Ownership transfer
}
```

---

## 7. Access Control Implementation

### 7.1 Critical Security Rules

| Operation | Required Permission | Validation Point |
|-----------|-------------------|------------------|
| View own memberships | Any member | Chat Graph |
| View owned indexes | Owner | Database layer |
| View all members | Owner | Database layer (throws) |
| View all indexed intents | Owner | Database layer (throws) |
| Update index settings | Owner | Database layer (throws) |
| Update member permissions | Owner/Admin | Database layer (throws) |

### 7.2 Database Layer Validation

All owner-only methods MUST validate ownership before returning data:

```typescript
async getIndexMembersForOwner(
  indexId: string,
  requestingUserId: string
): Promise<IndexMemberDetails[]> {
  // CRITICAL: Validate ownership first
  const isOwner = await this.isIndexOwner(indexId, requestingUserId);
  if (!isOwner) {
    throw new Error('Access denied: Not an owner of this index');
  }
  
  // Safe to return all members
  return await this.queryAllMembers(indexId);
}
```

### 7.3 Members View (Non-Owner)

When a non-owner asks about index intents, they should ONLY see their own:

```typescript
// For members (non-owners) - existing behavior
async getIndexMemberships(userId: string): Promise<IndexMembership[]>
// Returns only the user's own membership data

// For API endpoint fix (GET /indexes/:id/intents)
// Should check if user is owner:
// - Owner: return all intents
// - Member: return only their own intents
```

### 7.4 API Endpoint Fix Required

The current `GET /indexes/:id/intents` endpoint returns all intents to any member. This needs to be fixed:

```typescript
// routes/indexes.ts - Line ~1740
// BEFORE (insecure):
if (!isOwner && !isMember) {
  return res.status(403).json({ error: 'Access denied' });
}
// Then returns ALL intents...

// AFTER (secure):
if (!isOwner && !isMember) {
  return res.status(403).json({ error: 'Access denied' });
}

// Filter intents by ownership
const baseCondition = isOwner
  ? and(
      showArchived ? isNotNull(intents.archivedAt) : isNull(intents.archivedAt),
      eq(intentIndexes.indexId, indexId)
    )
  : and(
      showArchived ? isNotNull(intents.archivedAt) : isNull(intents.archivedAt),
      eq(intentIndexes.indexId, indexId),
      eq(intents.userId, req.user!.id)  // NON-OWNERS ONLY SEE THEIR OWN
    );
```

---

## 8. Implementation Phases

### Phase 1: Database Layer (Foundation)

**Files:**
- `protocol/src/lib/protocol/interfaces/database.interface.ts` - Add types and interface methods
- `protocol/src/lib/drizzle/database.ts` (or adapter) - Implement the new methods

**Tasks:**
1. Add new types (`OwnedIndex`, `IndexMemberDetails`, etc.)
2. Add new methods to `Database` interface
3. Implement methods with ownership validation
4. Add unit tests for ownership checks

**Estimated Scope:** ~150 lines of types, ~200 lines of implementation

### Phase 2: Router Updates

**Files:**
- `protocol/src/lib/protocol/agents/chat/router/chat.router.ts`

**Tasks:**
1. Add `index_write` to routing schema
2. Update system prompt with enhanced `index_query` and new `index_write` descriptions
3. Add test cases for ownership-related routing

**Estimated Scope:** ~50 lines of schema, ~100 lines of prompt

### Phase 3: Chat Graph Updates

**Files:**
- `protocol/src/lib/protocol/graphs/chat/chat.graph.ts`
- `protocol/src/lib/protocol/graphs/chat/chat.graph.state.ts`

**Tasks:**
1. Enhance `indexQueryNode` with ownership detection
2. Add new `indexWriteNode`
3. Update graph assembly with new routes
4. Update state types for index subgraph results

**Estimated Scope:** ~200 lines for nodes, ~50 lines for state

### Phase 4: Security Fix

**Files:**
- `protocol/src/routes/indexes.ts`

**Tasks:**
1. Fix `GET /indexes/:id/intents` to filter by ownership
2. Audit other endpoints for similar issues
3. Add integration tests

**Estimated Scope:** ~30 lines of fixes, ~100 lines of tests

### Phase 5: Response Generator Updates

**Files:**
- `protocol/src/lib/protocol/agents/chat/generator/chat.generator.ts`

**Tasks:**
1. Handle new index subgraph result formats
2. Format owner-specific responses appropriately
3. Provide helpful messaging for access denied scenarios

**Estimated Scope:** ~100 lines

---

## 9. Testing Strategy

### 9.1 Unit Tests

```typescript
// database.interface.spec.ts
describe('Index Ownership Database Methods', () => {
  describe('getOwnedIndexes', () => {
    it('returns only indexes where user has owner permission');
    it('returns empty array for users with no owned indexes');
    it('includes member and intent counts');
  });
  
  describe('getIndexMembersForOwner', () => {
    it('returns all members when requester is owner');
    it('throws when requester is not owner');
    it('throws when requester is admin but not owner');
    it('includes intent counts per member');
  });
  
  describe('getIndexIntentsForOwner', () => {
    it('returns all indexed intents when requester is owner');
    it('throws when requester is not owner');
    it('respects pagination options');
  });
});
```

### 9.2 Integration Tests

```typescript
// chat-graph-index-ownership.spec.ts
describe('Chat Graph - Index Ownership', () => {
  describe('index_query with ownership', () => {
    it('owner sees full member list when asking about their index');
    it('owner sees all indexed intents');
    it('member only sees their own membership info');
    it('member gets access denied message when asking for all members');
  });
  
  describe('index_write', () => {
    it('owner can update index title');
    it('owner can change privacy settings');
    it('non-owner receives access denied');
    it('admin receives access denied for settings changes');
  });
});
```

### 9.3 E2E Tests

```typescript
// e2e/index-ownership.test.ts
describe('Index Ownership E2E', () => {
  it('owner can ask "who are the members of my index" and see all members');
  it('owner can ask "what intents are in my index" and see all intents');
  it('owner can ask "make my index private" and settings are updated');
  it('member asking "who are the members" gets limited response');
});
```

---

## Appendix A: Sample Conversations

### Owner Viewing Members

```
User: Who are the members of my AI Founders index?

[Router: index_query, extractedContext: "AI Founders"]
[Chat Graph: Detects ownership → calls getIndexMembersForOwner]

Assistant: Your AI Founders index has 5 members:

| Member | Role | Intents Indexed |
|--------|------|----------------|
| Alice Chen | Owner | 12 |
| Bob Smith | Member | 8 |
| Carol Williams | Member | 5 |
| David Lee | Admin | 15 |
| Eve Johnson | Member | 3 |

Would you like to see the intents shared by any specific member?
```

### Member Attempting Owner Access

```
User: Who are the members of the AI Founders index?

[Router: index_query, extractedContext: "AI Founders"]
[Chat Graph: User is member but not owner → returns limited view]

Assistant: You are a member of the AI Founders index. As a member, you can see 
your own indexed intents but cannot view the full member list.

Your indexed intents in AI Founders:
- Looking for ML infrastructure engineers
- Seeking product feedback from fintech experts

If you need access to the full member list, please contact the index owner.
```

### Owner Updating Settings

```
User: Make my AI Founders index private

[Router: index_write, operationType: "update", extractedContext: "AI Founders: joinPolicy=invite_only"]
[Chat Graph: Validates ownership → calls updateIndexSettings]

Assistant: Done! Your AI Founders index is now private (invite-only). 
New members will need an invitation link to join.

Here is your invitation link: https://index.network/join/abc123

Would you like me to regenerate the invitation link or make any other changes?
```

---

## Appendix B: File Change Summary

| File | Changes |
|------|--------|
| `database.interface.ts` | Add types + 5 new methods |
| `chat.router.ts` | Add `index_write` target, update prompts |
| `chat.graph.ts` | Enhance `indexQueryNode`, add `indexWriteNode` |
| `chat.graph.state.ts` | Update SubgraphResults type for index |
| `indexes.ts` (routes) | Fix `GET /:id/intents` access control |
| `chat.generator.ts` | Handle new index result formats |

---

## Appendix C: Migration Considerations

### Backward Compatibility

- Existing `index_query` behavior preserved for non-owners
- No database migrations required (uses existing schema)
- API endpoints remain backward compatible

### Rollout Strategy

1. Deploy database interface changes (no breaking changes)
2. Deploy router updates (adds new route, existing routes unchanged)
3. Deploy chat graph updates (enhanced behavior for owners)
4. Deploy security fix for API endpoint (breaking change for non-owners who were incorrectly seeing all intents)

---

## Appendix D: Security Audit Checklist

- [ ] All owner-only database methods validate ownership before returning data
- [ ] Chat graph checks ownership before calling owner-only methods
- [ ] API endpoints filter data by ownership appropriately  
- [ ] Error messages do not leak sensitive information
- [ ] Admin role cannot access owner-only operations
- [ ] Member role cannot access owner or admin operations
- [ ] Ownership validation uses database query, not client-provided data
