# Opportunity System Redesign Plan

> **Status**: DRAFT - Discussion Only  
> **Author**: AI Assistant  
> **Date**: 2026-02-03  
> **Version**: 2.0 (Extensible Model)

## Executive Summary

This document outlines a redesign of the Opportunity system with an **extensible, schema-flexible architecture** that:

1. **Retires `intent_stakes`** — Clean break, no migration
2. **Drops I2I/I2P distinction** — Unified opportunity model
3. **Uses extensible JSON schemas** — Focus on data sources, actors, and reasoning
4. **Enables third-party matching** — Curators can create opportunities for others
5. **Separates data from presentation** — Descriptions generated at render time
6. **Supports agent-driven notifications** — No static thresholds

---

## 1. Design Principles

### 1.1 Core Philosophy

| Principle | Description |
|-----------|-------------|
| **Data over Presentation** | Store the "what, who, why" — generate descriptions on-demand |
| **Extensible by Default** | JSON schemas evolve without migrations |
| **Actor-Centric** | Opportunities have participants with roles, not fixed source/candidate |
| **Detection Agnostic** | Same opportunity structure whether found by AI, chat, or human curator |
| **Index-Scoped** | All opportunities exist within a community context |

### 1.2 What We're NOT Doing

- ❌ Static `matchType` enum (I2I, I2P)
- ❌ Fixed `sourceUserId` / `candidateUserId` columns
- ❌ Pre-computed `sourceDescription` / `candidateDescription`
- ❌ Incognito intent handling
- ❌ Data migration from `intent_stakes`
- ❌ Static notification thresholds

---

## 2. Opportunity Data Model

### 2.1 Schema Overview

```typescript
interface Opportunity {
  id: string;
  
  // ═══════════════════════════════════════════════════════════════
  // DETECTION: How was this opportunity discovered?
  // ═══════════════════════════════════════════════════════════════
  detection: {
    source: string;           // 'opportunity_graph' | 'chat' | 'manual' | 'cron'
    createdBy?: string;       // User ID if manual, Agent ID if automated
    triggeredBy?: string;     // What triggered it (intent ID, message ID, etc.)
    timestamp: string;
  };
  
  // ═══════════════════════════════════════════════════════════════
  // ACTORS: Who is involved in this opportunity?
  // ═══════════════════════════════════════════════════════════════
  actors: Array<{
    role: string;             // 'agent' | 'patient' | 'peer' | 'introducer' | ...
    identityId: string;       // User ID
    intents?: string[];       // Associated intent IDs (can be empty)
    profile?: boolean;        // Was profile used in matching?
  }>;
  
  // ═══════════════════════════════════════════════════════════════
  // INTERPRETATION: Why is this an opportunity?
  // ═══════════════════════════════════════════════════════════════
  interpretation: {
    category: string;         // 'collaboration' | 'hiring' | 'investment' | 'mentorship' | ...
    summary: string;          // Human-readable reasoning (NOT presentation copy)
    confidence: number;       // 0-1 score
    signals?: Array<{         // What signals contributed to this match?
      type: string;           // 'intent_match' | 'profile_similarity' | 'curator_judgment'
      weight: number;
      detail?: string;
    }>;
  };
  
  // ═══════════════════════════════════════════════════════════════
  // CONTEXT: Where does this opportunity exist?
  // ═══════════════════════════════════════════════════════════════
  context: {
    indexId: string;          // Required: community scope
    conversationId?: string;  // If detected in chat
    triggeringIntentId?: string;  // Primary intent that triggered discovery
  };
  
  // ═══════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════
  status: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}
```

### 2.2 Entity Relationship

```mermaid
erDiagram
    opportunities {
        uuid id PK
        jsonb detection "How it was found"
        jsonb actors "Who is involved"
        jsonb interpretation "Why it's an opportunity"
        jsonb context "Where it exists"
        text status "pending|viewed|accepted|rejected|expired"
        uuid index_id FK "Required: community scope"
        numeric confidence "Extracted for indexing"
        timestamp created_at
        timestamp updated_at
        timestamp expires_at
    }
    
    indexes ||--o{ opportunities : "scoped_to"
    users ||--o{ opportunities : "actor_in"
    intents ||--o{ opportunities : "referenced_by"
```

### 2.3 Example Opportunities

#### AI-Detected Match (Graph)
```json
{
  "detection": {
    "source": "opportunity_graph",
    "createdBy": "agent-opportunity-finder",
    "triggeredBy": "intent-abc123",
    "timestamp": "2026-02-03T10:00:00Z"
  },
  "actors": [
    { "role": "agent", "identityId": "alice-id", "intents": ["intent-abc123"], "profile": true },
    { "role": "patient", "identityId": "bob-id", "intents": ["intent-xyz789"], "profile": false }
  ],
  "interpretation": {
    "category": "hiring",
    "summary": "Alice is looking for a React developer; Bob has indicated availability for React contract work",
    "confidence": 0.87,
    "signals": [
      { "type": "intent_reciprocal", "weight": 0.8, "detail": "Complementary intents detected" },
      { "type": "profile_skills", "weight": 0.2, "detail": "Bob's profile lists React expertise" }
    ]
  },
  "context": {
    "indexId": "tech-founders-index",
    "triggeringIntentId": "intent-abc123"
  },
  "status": "pending"
}
```

#### Chat-Detected Match
```json
{
  "detection": {
    "source": "chat",
    "createdBy": "agent-chat-router",
    "triggeredBy": "message-12345",
    "timestamp": "2026-02-03T10:00:00Z"
  },
  "actors": [
    { "role": "peer", "identityId": "alice-id", "intents": [], "profile": true },
    { "role": "peer", "identityId": "bob-id", "intents": [], "profile": true }
  ],
  "interpretation": {
    "category": "collaboration",
    "summary": "During conversation, Alice mentioned interest in Web3 gaming; Bob is building in this space",
    "confidence": 0.72,
    "signals": [
      { "type": "conversation_context", "weight": 1.0, "detail": "Extracted from chat message" }
    ]
  },
  "context": {
    "indexId": "web3-builders-index",
    "conversationId": "chat-session-456"
  },
  "status": "pending"
}
```

#### Manual Curator Match
```json
{
  "detection": {
    "source": "manual",
    "createdBy": "carol-curator-id",
    "timestamp": "2026-02-03T10:00:00Z"
  },
  "actors": [
    { "role": "party", "identityId": "alice-id", "intents": ["intent-111"], "profile": true },
    { "role": "party", "identityId": "bob-id", "intents": [], "profile": true },
    { "role": "introducer", "identityId": "carol-curator-id", "intents": [] }
  ],
  "interpretation": {
    "category": "collaboration",
    "summary": "Alice is building an AI tool and Bob has ML expertise - seems like a great fit",
    "confidence": 0.85,
    "signals": [
      { "type": "curator_judgment", "weight": 1.0, "detail": "Manual match by index admin" }
    ]
  },
  "context": {
    "indexId": "ai-founders-index"
  },
  "status": "pending"
}
```

---

## 3. Actor Roles (Valency)

### 3.1 Core Roles

| Role | Description | UI Framing |
|------|-------------|------------|
| **agent** | Can DO something for others | "Someone who can help you" |
| **patient** | NEEDS something from others | "Someone you can help" |
| **peer** | Symmetric collaboration | "Potential collaborator" |
| **introducer** | Created/facilitated the match | "Introduced by..." |
| **party** | Generic participant (for manual matches) | Context-dependent |

### 3.2 Extended Roles (Future)

| Role | Description | Use Case |
|------|-------------|----------|
| **mentor** | Teaches/guides | Mentorship matching |
| **mentee** | Learns/receives guidance | Mentorship matching |
| **investor** | Provides capital | Fundraising |
| **founder** | Seeks capital | Fundraising |
| **referrer** | Knows relevant people | Network expansion |

### 3.3 Role Assignment

Roles are assigned by:
1. **LLM Analysis** — When opportunity graph evaluates candidates
2. **Curator Selection** — When manually creating opportunities
3. **Conversation Context** — When detected in chat

```typescript
// OpportunityEvaluator determines roles based on intent analysis
const rolePrompt = `
Analyze the relationship between these two parties:
- Party A: ${partyA.intent || partyA.profile}
- Party B: ${partyB.intent || partyB.profile}

Determine the valency role for each:
- "agent": Party CAN DO something for the other
- "patient": Party NEEDS something from the other
- "peer": Symmetric collaboration, neither dominant
`;
```

---

## 4. Detection Sources

### 4.1 Automated Detection

| Source | Trigger | Description |
|--------|---------|-------------|
| `opportunity_graph` | Intent created/updated | Background graph runs HyDE matching |
| `chat` | Message in conversation | Chat agent identifies opportunity during dialogue |
| `cron` | Scheduled job | Periodic re-scan for stale profiles/intents |
| `member_added` | User joins index | Scan new member against existing members |

### 4.2 Manual Detection

| Source | Trigger | Description |
|--------|---------|-------------|
| `manual` | Curator action | Index admin creates opportunity for two members |
| `request` | User request | User requests introduction to another member |
| `suggestion` | Non-admin suggestion | Member suggests match (requires approval) |

### 4.3 Detection Flow

```mermaid
flowchart TD
    subgraph "Automated"
        INTENT["Intent Created"] --> GRAPH["OpportunityGraph"]
        CHAT["Chat Message"] --> CHAT_AGENT["Chat Agent"]
        CRON["Cron Job"] --> SCAN["Profile Scanner"]
    end
    
    subgraph "Manual"
        ADMIN["Index Admin"] --> CREATE["Create Opportunity"]
        MEMBER["Index Member"] --> SUGGEST["Suggest Opportunity"]
        SUGGEST --> APPROVAL{"Admin Approval"}
        APPROVAL -->|Approved| CREATE
    end
    
    GRAPH --> OPP["Opportunity Created"]
    CHAT_AGENT --> OPP
    SCAN --> OPP
    CREATE --> OPP
```

---

## 5. HyDE Strategy (Decoupled)

### 5.1 HyDE is a Search Strategy, Not a Match Type

The HyDE vectors are **search tools**, not opportunity classifiers. The same opportunity can be found via different HyDE strategies.

```mermaid
flowchart LR
    subgraph "HyDE Strategies (How we search)"
        MIRROR["Mirror HyDE<br/>(Find profiles)"]
        RECIP["Reciprocal HyDE<br/>(Find intents)"]
        CUSTOM["Custom HyDE<br/>(On-demand)"]
    end
    
    subgraph "Opportunities (What we create)"
        OPP["Generic Opportunity<br/>(actors + interpretation)"]
    end
    
    MIRROR --> OPP
    RECIP --> OPP
    CUSTOM --> OPP
```

### 5.2 HyDE Types

| Strategy | Purpose | Searches Against | When Used |
|----------|---------|------------------|-----------|
| **Mirror** | Find profiles that satisfy intent | `user_profiles.hyde_embedding` | Always (pre-computed) |
| **Reciprocal** | Find complementary intents | `intents.embedding` | Always (pre-computed) |
| **Custom** | Context-specific search | Varies | On-demand (e.g., "find mentors") |

### 5.3 Intent HyDE Storage

```sql
-- Intents store pre-computed HyDE vectors
ALTER TABLE intents
ADD COLUMN mirror_hyde_text TEXT,
ADD COLUMN mirror_hyde_embedding vector(2000),
ADD COLUMN reciprocal_hyde_text TEXT,
ADD COLUMN reciprocal_hyde_embedding vector(2000);
```

### 5.4 Signals in Interpretation

When an opportunity is created, the `interpretation.signals` array tracks which HyDE strategy contributed:

```json
{
  "signals": [
    { "type": "mirror_hyde", "weight": 0.6, "detail": "Profile matched mirror description" },
    { "type": "reciprocal_hyde", "weight": 0.4, "detail": "Intent matched reciprocal description" }
  ]
}
```

---

## 6. Database Schema

### 6.1 SQL Definition

```sql
-- Main opportunities table
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Extensible JSON fields
  detection JSONB NOT NULL,
  actors JSONB NOT NULL,
  interpretation JSONB NOT NULL,
  context JSONB NOT NULL,
  
  -- Indexed fields (extracted for queries)
  index_id UUID NOT NULL REFERENCES indexes(id),
  confidence NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'viewed', 'accepted', 'rejected', 'expired')),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Index for finding opportunities by actor
CREATE INDEX opportunities_actors_idx ON opportunities 
USING GIN (actors jsonb_path_ops);

-- Index for finding opportunities by index
CREATE INDEX opportunities_index_idx ON opportunities(index_id);

-- Index for status queries
CREATE INDEX opportunities_status_idx ON opportunities(status);

-- Index for expiration cron
CREATE INDEX opportunities_expires_idx ON opportunities(expires_at) 
WHERE expires_at IS NOT NULL;

-- Composite for common query: user's pending opportunities in an index
CREATE INDEX opportunities_actor_index_status_idx ON opportunities 
USING GIN (actors jsonb_path_ops) 
WHERE status = 'pending';
```

### 6.2 Query Examples

```sql
-- Find all opportunities for a user
SELECT * FROM opportunities 
WHERE actors @> '[{"identityId": "user-123"}]'::jsonb
ORDER BY created_at DESC;

-- Find opportunities where user is the "agent" role
SELECT * FROM opportunities 
WHERE actors @> '[{"identityId": "user-123", "role": "agent"}]'::jsonb;

-- Find manual opportunities (curator-created)
SELECT * FROM opportunities 
WHERE detection->>'source' = 'manual';

-- Find opportunities with high confidence
SELECT * FROM opportunities 
WHERE confidence > 0.8 
ORDER BY confidence DESC;

-- Find opportunities involving a specific intent
SELECT * FROM opportunities 
WHERE actors @> '[{"intents": ["intent-abc123"]}]'::jsonb;
```

### 6.3 Drizzle Schema

```typescript
// schemas/database.schema.ts

import { pgTable, uuid, jsonb, text, numeric, timestamp, index } from 'drizzle-orm/pg-core';

// JSON type definitions
export interface OpportunityDetection {
  source: string;
  createdBy?: string;
  triggeredBy?: string;
  timestamp: string;
}

export interface OpportunityActor {
  role: string;
  identityId: string;
  intents?: string[];
  profile?: boolean;
}

export interface OpportunitySignal {
  type: string;
  weight: number;
  detail?: string;
}

export interface OpportunityInterpretation {
  category: string;
  summary: string;
  confidence: number;
  signals?: OpportunitySignal[];
}

export interface OpportunityContext {
  indexId: string;
  conversationId?: string;
  triggeringIntentId?: string;
}

export const opportunityStatusEnum = pgEnum('opportunity_status', [
  'pending', 'viewed', 'accepted', 'rejected', 'expired'
]);

export const opportunities = pgTable('opportunities', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Extensible JSON fields
  detection: jsonb('detection').$type<OpportunityDetection>().notNull(),
  actors: jsonb('actors').$type<OpportunityActor[]>().notNull(),
  interpretation: jsonb('interpretation').$type<OpportunityInterpretation>().notNull(),
  context: jsonb('context').$type<OpportunityContext>().notNull(),
  
  // Indexed fields
  indexId: uuid('index_id').notNull().references(() => indexes.id),
  confidence: numeric('confidence').notNull(),
  status: opportunityStatusEnum('status').notNull().default('pending'),
  
  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});
```

---

## 7. Presentation Layer

### 7.1 Descriptions Generated On-Demand

Descriptions are NOT stored. They are generated at render time based on:
- Viewer's identity (which actor am I?)
- Viewer's role in the opportunity
- Context (email, push notification, UI card)

```typescript
// services/opportunity.presentation.ts

interface OpportunityPresentation {
  title: string;
  description: string;
  callToAction: string;
}

function presentOpportunity(
  opp: Opportunity, 
  viewerId: string,
  format: 'card' | 'email' | 'notification'
): OpportunityPresentation {
  const myActor = opp.actors.find(a => a.identityId === viewerId);
  const otherActors = opp.actors.filter(a => a.identityId !== viewerId && a.role !== 'introducer');
  const introducer = opp.actors.find(a => a.role === 'introducer');
  
  if (!myActor) {
    throw new Error('Viewer is not an actor in this opportunity');
  }
  
  // Get other party's name (from profile service)
  const otherName = await getDisplayName(otherActors[0]?.identityId);
  
  // Generate role-appropriate framing
  let title: string;
  let description: string;
  
  switch (myActor.role) {
    case 'agent':
      title = `You can help ${otherName}`;
      description = `Based on your expertise, ${otherName} might benefit from connecting with you.`;
      break;
    case 'patient':
      title = `${otherName} might be able to help you`;
      description = `${otherName} has skills that align with what you're looking for.`;
      break;
    case 'peer':
      title = `Potential collaboration with ${otherName}`;
      description = `You and ${otherName} have complementary interests.`;
      break;
    case 'party':
      if (introducer) {
        const introducerName = await getDisplayName(introducer.identityId);
        title = `${introducerName} thinks you should meet ${otherName}`;
        description = opp.interpretation.summary;
      } else {
        title = `Opportunity with ${otherName}`;
        description = opp.interpretation.summary;
      }
      break;
  }
  
  // Add interpretation context
  description += `\n\n${opp.interpretation.summary}`;
  
  // Format-specific adjustments
  if (format === 'notification') {
    description = truncate(description, 100);
  }
  
  return {
    title,
    description,
    callToAction: 'View Opportunity'
  };
}
```

### 7.2 API Response

```typescript
// GET /api/opportunities/:id
interface OpportunityResponse {
  id: string;
  
  // Presentation (generated for viewer)
  presentation: {
    title: string;
    description: string;
    callToAction: string;
  };
  
  // My role in this opportunity
  myRole: string;
  
  // Other parties (names, not full profiles)
  otherParties: Array<{
    id: string;
    name: string;
    avatar?: string;
    role: string;
  }>;
  
  // If introduced
  introducedBy?: {
    id: string;
    name: string;
    avatar?: string;
  };
  
  // Category and confidence
  category: string;
  confidence: number;
  
  // Context
  index: {
    id: string;
    title: string;
  };
  
  // Lifecycle
  status: string;
  createdAt: string;
  expiresAt?: string;
}
```

---

## 8. Manual Opportunity Creation

### 8.1 API Endpoint

```typescript
// POST /api/indexes/:indexId/opportunities

interface CreateManualOpportunityRequest {
  // Who is being matched (2+ parties)
  parties: Array<{
    userId: string;
    intentId?: string;  // Optional: link to specific intent
  }>;
  
  // Curator's reasoning
  reasoning: string;
  
  // Optional: category
  category?: string;
  
  // Optional: confidence (default 0.8 for manual)
  confidence?: number;
}

// Example request
{
  "parties": [
    { "userId": "alice-id", "intentId": "intent-123" },
    { "userId": "bob-id" }
  ],
  "reasoning": "Alice is building an AI tool, Bob has ML expertise - great fit",
  "category": "collaboration",
  "confidence": 0.85
}
```

### 8.2 Permission Model

| Creator Role | Can Create For | Approval Required |
|--------------|----------------|-------------------|
| Index Admin | Any members | No |
| Index Member (self-involved) | Self + other member | No |
| Index Member (not involved) | Any members | Yes (admin approval) |

```typescript
// middleware/opportunity.permissions.ts

async function canCreateOpportunity(
  creatorId: string, 
  partyIds: string[], 
  indexId: string
): Promise<{ allowed: boolean; requiresApproval: boolean }> {
  const isAdmin = await isIndexAdmin(creatorId, indexId);
  const isSelfIncluded = partyIds.includes(creatorId);
  
  if (isAdmin) {
    return { allowed: true, requiresApproval: false };
  }
  
  if (isSelfIncluded) {
    return { allowed: true, requiresApproval: false };
  }
  
  // Non-admin, not involved → needs approval
  return { allowed: true, requiresApproval: true };
}
```

### 8.3 Transformation to Opportunity

```typescript
// services/opportunity.service.ts

async function createManualOpportunity(
  indexId: string,
  creatorId: string,
  request: CreateManualOpportunityRequest
): Promise<Opportunity> {
  const { parties, reasoning, category, confidence } = request;
  
  // Build actors array
  const actors: OpportunityActor[] = parties.map(p => ({
    role: 'party',  // Manual matches use generic 'party' role
    identityId: p.userId,
    intents: p.intentId ? [p.intentId] : [],
    profile: true
  }));
  
  // Add introducer (the creator)
  actors.push({
    role: 'introducer',
    identityId: creatorId,
    intents: []
  });
  
  const opportunity: NewOpportunity = {
    detection: {
      source: 'manual',
      createdBy: creatorId,
      timestamp: new Date().toISOString()
    },
    actors,
    interpretation: {
      category: category || 'collaboration',
      summary: reasoning,
      confidence: confidence || 0.8,
      signals: [
        { type: 'curator_judgment', weight: 1.0, detail: 'Manual match by curator' }
      ]
    },
    context: {
      indexId
    },
    indexId,
    confidence: confidence || 0.8,
    status: 'pending'
  };
  
  return await db.insert(opportunities).values(opportunity).returning();
}
```

---

## 9. Opportunity Graph (Automated Detection)

### 9.1 Graph Architecture

```mermaid
stateDiagram-v2
    [*] --> PrepNode: START
    
    PrepNode --> RouteNode: Intent loaded
    
    state RouteNode <<choice>>
    RouteNode --> HydeNode: No HyDE vectors
    RouteNode --> SearchNode: HyDE exists
    
    HydeNode --> SearchNode: Vectors generated
    
    state SearchNode {
        [*] --> ProfileSearch: Mirror HyDE
        [*] --> IntentSearch: Reciprocal HyDE
        ProfileSearch --> [*]: Profile candidates
        IntentSearch --> [*]: Intent candidates
    }
    
    SearchNode --> EvaluateNode: Candidates found
    SearchNode --> [*]: No candidates (END)
    
    EvaluateNode --> PersistNode: Opportunities created
    
    PersistNode --> NotifyNode: Saved
    
    NotifyNode --> [*]: END
```

### 9.2 Graph State

```typescript
// opportunity.graph.state.ts

import { Annotation } from "@langchain/langgraph";

export const OpportunityGraphState = Annotation.Root({
  // Input
  intentId: Annotation<string>,
  userId: Annotation<string>,
  
  // Control
  operationMode: Annotation<'create' | 'refresh'>({
    default: () => 'create',
  }),
  
  // Intermediate - Intent Data
  intent: Annotation<Intent | null>({
    default: () => null,
  }),
  
  // Intermediate - HyDE vectors
  hydeVectors: Annotation<{
    mirror: { text: string; embedding: number[] } | null;
    reciprocal: { text: string; embedding: number[] } | null;
  }>({
    default: () => ({ mirror: null, reciprocal: null }),
  }),
  
  // Intermediate - User's index memberships
  userIndexIds: Annotation<string[]>({
    default: () => [],
  }),
  
  // Intermediate - Candidates from search
  candidates: Annotation<Array<{
    type: 'profile' | 'intent';
    userId: string;
    intentId?: string;
    score: number;
    indexId: string;  // Which shared index
  }>>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  
  // Output
  opportunities: Annotation<Opportunity[]>({
    reducer: (curr, next) => next,
    default: () => [],
  }),
});
```

### 9.3 Opportunity Creation in Graph

```typescript
// opportunity.graph.ts - EvaluateNode

const evaluateNode = async (state: typeof OpportunityGraphState.State) => {
  const { intent, candidates, userId } = state;
  
  const opportunities: Opportunity[] = [];
  
  for (const candidate of candidates) {
    // Determine roles via LLM
    const roles = await determineRoles(intent, candidate);
    
    // Build actors array
    const actors: OpportunityActor[] = [
      {
        role: roles.source,
        identityId: userId,
        intents: [intent.id],
        profile: false
      },
      {
        role: roles.candidate,
        identityId: candidate.userId,
        intents: candidate.intentId ? [candidate.intentId] : [],
        profile: candidate.type === 'profile'
      }
    ];
    
    // Build interpretation
    const evaluation = await evaluateMatch(intent, candidate);
    
    const opportunity: Opportunity = {
      detection: {
        source: 'opportunity_graph',
        createdBy: 'agent-opportunity-finder',
        triggeredBy: intent.id,
        timestamp: new Date().toISOString()
      },
      actors,
      interpretation: {
        category: evaluation.category,
        summary: evaluation.reasoning,
        confidence: evaluation.confidence,
        signals: [
          { 
            type: candidate.type === 'profile' ? 'mirror_hyde' : 'reciprocal_hyde',
            weight: candidate.score,
            detail: `Matched via ${candidate.type} search`
          }
        ]
      },
      context: {
        indexId: candidate.indexId,
        triggeringIntentId: intent.id
      },
      status: 'pending'
    };
    
    opportunities.push(opportunity);
  }
  
  return { opportunities };
};
```

---

## 10. Side Effects & Notifications

### 10.1 Graph-Based Side Effects

All side effects are handled **directly within the graph** — no separate events file.

```mermaid
flowchart TD
    subgraph "OpportunityGraph"
        PERSIST["PersistNode<br/>(saves opportunities)"]
        PERSIST --> NOTIFY["NotifyNode<br/>(inline side effects)"]
    end
    
    subgraph "NotifyNode Actions"
        NOTIFY --> AGENT["Notification Agent<br/>(decides if/when to notify)"]
        AGENT --> WS["WebSocket Broadcast"]
        AGENT --> QUEUE["Queue Email Job"]
        AGENT --> LOG["Audit Log"]
    end
```

### 10.2 Agent-Driven Notifications

No static thresholds. A notification agent evaluates context:

```typescript
// NotifyNode
const notifyNode = async (state: typeof OpportunityGraphState.State) => {
  const { opportunities } = state;
  
  for (const opp of opportunities) {
    for (const actor of opp.actors) {
      if (actor.role === 'introducer') continue; // Don't notify self
      
      const shouldNotify = await notificationAgent.evaluate({
        opportunity: opp,
        userId: actor.identityId,
        factors: {
          confidence: opp.interpretation.confidence,
          detectionSource: opp.detection.source,
          userRecentActivity: await getUserActivity(actor.identityId),
          existingUnviewedCount: await getUnviewedCount(actor.identityId),
          timeOfDay: new Date().getHours(),
          category: opp.interpretation.category
        }
      });
      
      if (shouldNotify.immediate) {
        await websocketService.broadcast(actor.identityId, {
          type: 'opportunity_created',
          opportunityId: opp.id,
          preview: generatePreview(opp, actor.identityId)
        });
      }
      
      if (shouldNotify.email) {
        await emailQueue.add('opportunity_notification', {
          userId: actor.identityId,
          opportunityId: opp.id,
          priority: shouldNotify.emailPriority
        });
      }
    }
  }
};
```

### 10.3 Notification Agent Considerations

| Factor | High Priority | Low Priority |
|--------|--------------|--------------|
| Confidence | > 0.8 | < 0.6 |
| Detection source | `manual` (curator) | `cron` (background) |
| Category | `hiring`, `investment` | `networking` |
| User activity | Active in last 24h | Inactive > 7 days |
| Unviewed count | < 3 | > 10 (batch instead) |
| Time of day | Business hours | Night |

---

## 11. Index Scoping

### 11.1 Community Boundaries

All opportunities exist within an index context. Users can only match through shared index memberships.

```mermaid
flowchart TD
    subgraph "Index A: Tech Founders"
        UA1["Alice"]
        UB1["Bob"]
    end
    
    subgraph "Index B: AI Researchers"
        UA2["Alice"]
        UC1["Carol"]
    end
    
    UA1 <-->|"Can match"| UB1
    UA2 <-->|"Can match"| UC1
    UB1 -.->|"Cannot match<br/>(no shared index)"| UC1
```

### 11.2 Index Selection for Multi-Index Users

When users share multiple indexes, select one using this priority:

1. Index where triggering intent is assigned
2. First shared index (alphabetically by ID for determinism)

```typescript
function selectIndexForOpportunity(
  triggeringIntentId: string | null,
  sharedIndexIds: string[]
): string {
  if (triggeringIntentId) {
    const intentIndex = getIntentIndexAssignment(triggeringIntentId, sharedIndexIds);
    if (intentIndex) return intentIndex;
  }
  
  return sharedIndexIds.sort()[0];
}
```

### 11.3 Index Settings

```typescript
// indexes.settings schema
interface IndexSettings {
  opportunities?: {
    expirationDays?: number;        // Default: 30
    allowManualCreation?: boolean;  // Default: true (for admins)
    allowMemberSuggestions?: boolean; // Default: false
  };
}
```

---

## 12. Edge Cases

### 12.1 Self-Matching Prevention

```typescript
// Filter out self-matches
const validCandidates = candidates.filter(c => c.userId !== sourceUserId);
```

### 12.2 Duplicate Prevention

Use functional unique index on actor pairs per index:

```sql
-- Prevent duplicate opportunities between same actor pair in same index
CREATE UNIQUE INDEX opportunities_actors_unique ON opportunities (
  (SELECT jsonb_agg(elem->>'identityId' ORDER BY elem->>'identityId') 
   FROM jsonb_array_elements(actors) elem 
   WHERE elem->>'role' != 'introducer'),
  index_id
);
```

Alternative: Check before insert:

```typescript
async function opportunityExists(actorIds: string[], indexId: string): Promise<boolean> {
  const sorted = actorIds.sort();
  const existing = await db.select()
    .from(opportunities)
    .where(and(
      eq(opportunities.indexId, indexId),
      sql`actors @> ${JSON.stringify(sorted.map(id => ({ identityId: id })))}`
    ))
    .limit(1);
  
  return existing.length > 0;
}
```

### 12.3 Archived Intent Handling

When an intent is archived, expire related opportunities:

```typescript
async function onIntentArchived(intentId: string) {
  await db.update(opportunities)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(sql`actors @> '[{"intents": ["${intentId}"]}]'::jsonb`);
}
```

### 12.4 Member Removed from Index

```typescript
async function onMemberRemoved(indexId: string, userId: string) {
  await db.update(opportunities)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(and(
      eq(opportunities.indexId, indexId),
      sql`actors @> '[{"identityId": "${userId}"}]'::jsonb`,
      ne(opportunities.status, 'expired')
    ));
}
```

### 12.5 Status State Machine

```mermaid
stateDiagram-v2
    [*] --> pending: Created
    pending --> viewed: User opens
    pending --> expired: TTL or intent archived
    viewed --> accepted: User accepts
    viewed --> rejected: User rejects
    viewed --> expired: TTL exceeded
    accepted --> [*]: Terminal
    rejected --> [*]: Terminal
    expired --> [*]: Terminal
```

---

## 13. API Endpoints

### 13.1 Opportunity CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/opportunities` | List opportunities for authenticated user |
| `GET` | `/api/opportunities/:id` | Get single opportunity (presentation included) |
| `PATCH` | `/api/opportunities/:id/status` | Update status (accept/reject) |
| `POST` | `/api/indexes/:indexId/opportunities` | Create manual opportunity (curator) |
| `GET` | `/api/indexes/:indexId/opportunities` | List all opportunities in index (admin) |

### 13.2 Query Parameters

```
GET /api/opportunities?status=pending&limit=20&offset=0
GET /api/opportunities?category=hiring
GET /api/opportunities?role=agent
```

---

## 14. Implementation Checklist

### Phase 1: Schema & Foundation
- [ ] Create new `opportunities` table with JSONB fields
- [ ] Add GIN indexes for actor queries
- [ ] Update Drizzle schema with TypeScript types
- [ ] Add HyDE columns to `intents` table
- [ ] Add `settings` column to `indexes` table

### Phase 2: Core Logic
- [ ] Create `IntentHydeGenerator` agent
- [ ] Refactor `OpportunityGraph` with new state
- [ ] Implement index-scoped candidate search
- [ ] Implement `OpportunityEvaluator` for role determination
- [ ] Create presentation service for on-demand descriptions

### Phase 3: Manual Creation
- [ ] Add `POST /indexes/:indexId/opportunities` endpoint
- [ ] Implement permission model (admin vs member)
- [ ] Add suggestion/approval flow for non-admin members

### Phase 4: Notifications
- [ ] Create notification agent for smart delivery
- [ ] Add `NotifyNode` to `OpportunityGraph`
- [ ] Implement WebSocket broadcasts
- [ ] Add email queue integration

### Phase 5: Lifecycle
- [ ] Implement status transitions
- [ ] Add `onIntentArchived` handler
- [ ] Add `onMemberRemoved` handler
- [ ] Create expiration cron job

### Phase 6: API & Frontend
- [ ] Implement all API endpoints
- [ ] Add access control middleware
- [ ] Update frontend to use presentation layer

### Phase 7: Cleanup
- [ ] Remove `SemanticRelevancyBroker`
- [ ] Drop `intent_stakes` table (clean break)
- [ ] Drop `intent_stake_items` table
- [ ] Update documentation

---

## 15. Appendix: Migration from Old Schema

### No Data Migration

Per product owner decision, we do a **clean break**:
- Do not migrate `intent_stakes` to `opportunities`
- Users start fresh with new opportunity system
- Old stakes can be archived/backed up but not converted

### Communication Plan
- Notify users that "Connections" section is being upgraded
- Existing connections (accepted stakes) remain as connections
- Unaccepted stakes are not carried over

---

## 16. Appendix: Future Extensions

### 16.1 Multi-Party Opportunities (3+ actors)
```json
{
  "actors": [
    { "role": "introducer", "identityId": "carol" },
    { "role": "party", "identityId": "alice" },
    { "role": "party", "identityId": "bob" },
    { "role": "party", "identityId": "dave" }
  ]
}
```

### 16.2 Referral Chains
```json
{
  "actors": [
    { "role": "referee", "identityId": "alice" },
    { "role": "target", "identityId": "bob" },
    { "role": "introducer", "identityId": "carol" },
    { "role": "original_referrer", "identityId": "dave" }
  ]
}
```

### 16.3 DID Integration
```typescript
actors: [
  { role: 'agent', identityId: 'did:eth:0x1234...' }
]
```

### 16.4 Cross-Index Opportunities (with permission)
```json
{
  "context": {
    "indexId": "primary-index",
    "crossIndexIds": ["secondary-index"]
  }
}
```

---

## 17. References

1. [HyDE Strategies Document](../src/lib/protocol/docs/HyDE%20Strategies%20for%20Explicit%20Intent%20Matching%20and%20Retrieval.md)
2. [LangGraph Patterns](../.cursor/rules/langgraph-patterns.mdc)
3. [File Naming Convention](../.cursor/rules/file-naming-convention.mdc)
