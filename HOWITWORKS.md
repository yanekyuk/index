# Index Network: Technical Architecture

## Overview

Index Network is a discovery protocol that fundamentally reimagines how people connect online. Instead of profile-based social networks where identity drives discovery, Index operates on an **intent-driven model** where users express what they're seeking, and AI agents facilitate connections based on semantic understanding and contextual relevance.

By centering discovery on **indexes** (privacy-controlled intent collections) and **intents** (open-ended expressions of what someone seeks), Index enables a more efficent, private, and personal way for people to connect.

**Current Implementation**: The protocol currently uses PostgreSQL for all data storage with application-layer privacy controls (index-based access control). The architecture is designed with TEE-compatible topology for future deployment with confidential compute environments and decentralized storage.

## Architectural Principles

### 1. Intent Over Identity

Traditional social platforms focus on *who you are* – your job title, company, education. Index focuses on *what you want* – your goals, needs, and interests expressed as structured intents. This exciting shift enables more meaningful connections because it matches people based on complementary objectives rather than similar backgrounds.

**Intent Typology**: Index primarily focuses on **social intents** - expressions of presence and availability for connection. Within the broader landscape of digital intent, there are many intent types:

- **Social Intent** — Connecting, relating, engaging with others socially ("We're here.")
- **Transactional Intent** — Buying, hiring, exchanging  
- **Information-Seeking Intent** — Asking, searching
- **Latent/Other Intent** — Watching, inferring, delegating

Index specializes in the social intent space, enabling people to signal their presence, availability, and interests for collaboration, socializing, and meaningful relationships.

**Technical Implementation**: Intents are stored as text payloads that can be enhanced with contextual information from associated files. Index treats intents as first-class entities with their own lifecycle, privacy controls, and agent interactions.

### 2. Privacy by Design

Privacy isn't an afterthought but a foundational design constraint. Index uses a multi-layered access control model where content is organized into **indexes** with granular permissions. Users can share specific contexts without exposing their entire intentions, just like we do in real life.

**Technical Implementation**: Index-based access control with three permission levels:
- `owner`: Full access (manage members, settings, read/write intents)
- `admin`: Can manage members (except owners) and settings
- `member`: Standard access (read/write intents)

### 3. Agent-Mediated Context

Rather than algorithmic matching or manual browsing, multiple AI agents coexist to maintain relationships between contextual elements. The integrity of these relationships forms the context itself as an emergent property—this emergence is the architecture, not imposed frameworks or predefined models.

**Technical Implementation**: Opportunity agents that analyze profile and intent relationships to surface potential connections. Each opportunity carries dual descriptions—one for each party—preserving contextual integrity while enabling meaningful discovery.

## Core Data Architecture

### Intent Graph

The core data layer stores the essential relationships between users, their intents, and organizational contexts:

```sql
-- Users have multiple intents across different contexts
users ←→ intents (1:many)
-- Users have profiles with semantic embeddings for discovery
users ←→ user_profiles (1:1)
-- Intents can belong to multiple indexes (contexts)
intents ←→ indexes (many:many via intent_indexes)
-- Indexes have members with specific permissions
indexes ←→ users (many:many via index_members)
-- Agents surface opportunities between users
opportunities → {source_user, candidate_user, dual_descriptions, score}
```

**Why this structure**: The many-to-many relationship between intents and indexes is fundamental for enabling **private discovery networks** across organizations, communities, and professional groups. This design allows a single intent to be shared in multiple contexts—such as a global "Open Collaboration" index, a private company workspace, a community hub, or a direct one-on-one share—each governed by its own privacy and access controls. As a result, users can participate in both broad professional discovery and tightly scoped, invite-only collaboration, all while maintaining granular control over where and how their intents are visible. 

### Future Architecture: Scalable Intent Storage with TEE

**Planned Future Deployment**: Intents will be migrated to **off-chain** storage with **on-chain finality** using a hash and roll-up architecture. This future approach will enable:

- **Peer-to-Peer Discovery**: Agents enable direct, programmable discovery without intermediaries
- **Programmable Incentives**: Agents can deploy custom incentive logic at the protocol layer
- **Privacy**: Raw intent data processed only in confidential compute; not exposed on public chains
- **Integrity**: Cryptographic proofs guarantee data authenticity
- **Performance**: Fast, low-latency queries without blockchain bottlenecks

**Privacy Architecture (Planned)**: The protocol is designed for intents to be **only accessible to agents running in TEE-protected confidential compute environments**. The agent runtime will maintain storage and retrieval within TEE infrastructure. No intent data will be exposed to:
- Public networks or APIs
- User interfaces directly (except for own data)
- Non-TEE computational environments
- Third-party systems

Users will access their own intent data through standard interfaces, but agents will query the protected database using natural language within the confidential compute network when analyzing cross-user relationships. When agents find matches, they share **only their reasoning and confidence scores** with users—never the raw intent data of other users.

### Why This Separation

The separation between intents and indexes serves a crucial strategic purpose: **context isolation for privacy management**. This architectural decision enables users to share different aspects of their intents in different contexts.

Context isolation makes privacy management practical and intuitive. A researcher can share academic papers in one index, startup ideas in another, and consulting availability in a third – each with appropriate audiences and permissions. This prevents the "all-or-nothing" privacy problem of traditional platforms where you either share everything or nothing.

## Agent Runtime Architecture

### Opportunity Discovery

**Opportunity**: A legible coordination point where aligned intents, trust thresholds, timing constraints, and expected value make action rational.

Opportunities are not mere "matches"—they are **first-class entities** that capture the *conditions under which coordination becomes possible*. Each opportunity represents a moment in time where multiple factors converge:

**Multi-Dimensional Alignment**:

1. **Intent Alignment** (Semantic Layer)
   - Vector similarity between what users seek and offer
   - HyDE-enhanced search across multiple relationship strategies (peer, mentor, reciprocal)
   - Semantic distance thresholds ensure meaningful overlap, not superficial keyword matches

2. **Trust Thresholds** (Social Layer)
   - Profile completeness and verification signals
   - Index membership overlap (shared contexts)
   - Historical interaction patterns and acceptance rates
   - Agent confidence scores aggregated across multiple evaluation dimensions

3. **Timing Constraints** (Temporal Layer)
   - Intent freshness (recently updated = actively seeking)
   - Availability signals from profile activity patterns
   - Time-bounded opportunities (e.g., "hiring next quarter")
   - Expiration logic to prevent stale coordination attempts

4. **Expected Value** (Economic Layer)
   - Mutual benefit assessment: both parties gain
   - Asymmetry detection: what each party uniquely provides
   - Opportunity cost: is this better than alternatives?
   - Network effects: does this connection enable future opportunities?

**Technical Implementation**: Opportunities are stored with JSONB fields for extensibility:

```typescript
interface Opportunity {
  id: string;
  indexId: string | null;          // Optional index context for privacy scoping
  
  detection: {                      // Provenance: how was this detected?
    method: 'profile_update' | 'intent_created' | 'manual';
    triggeredBy: string;            // User or agent that caused detection
    triggeredAt: Date;
    hydeStrategies?: string[];      // Which HyDE strategies were used
  };
  
  actors: {                         // The parties and their roles
    source: { 
      userId: string; 
      role: string;                 // e.g., 'seeker', 'mentor', 'investor'
    };
    candidate: { 
      userId: string; 
      role: string;                 // e.g., 'provider', 'mentee', 'founder'
    };
  };
  
  interpretation: {                 // Agent's understanding (dual perspective)
    synthesis: string;              // Value proposition for source
    candidateSynthesis: string;     // Value proposition for candidate
    confidence: number;             // 0-100: composite score across dimensions
    reasoning?: string;             // Optional: agent's chain-of-thought
  };
  
  context: {                        // Extensible metadata
    intentIds?: string[];           // Which intents contributed to detection
    semanticDistance?: number;      // Vector similarity score
    sharedIndexes?: string[];       // Common contexts
    valencyType?: 'symmetric' | 'asymmetric';  // Relationship structure
    [key: string]: unknown;         // Future extensibility
  };
  
  status: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
  lifecycle: {
    createdAt: Date;
    viewedAt?: Date;
    resolvedAt?: Date;
    expiresAt?: Date;
  };
}
```

**Context Broker Pattern**: Opportunity detection exemplifies event-driven architecture. When a profile updates, the Opportunity Finder context broker:

1. **Reacts**: Subscribes to profile update events (decoupled from profile service)
2. **Searches**: Generates multiple HyDE documents (mirror, reciprocal, mentor strategies) and performs parallel vector searches
3. **Evaluates**: Scores candidates across trust/timing/value dimensions using configurable thresholds
4. **Filters**: Applies business logic (e.g., don't surface same candidate twice in 7 days)
5. **Surfaces**: Creates opportunity records with dual interpretations when all conditions align

This pattern enables extensibility: new context brokers can be added (e.g., project-based matching, skill-gap analysis) without modifying core systems.

### Opportunities as Coordination Primitives

Opportunities are not transient suggestions—they are **durable coordination primitives** that capture the structural conditions enabling collaboration.

**Philosophical Foundation**: Drawing from coordination theory and market microstructure, opportunities represent the moment when transaction costs fall below expected value. They are to social coordination what limit orders are to financial markets: standing offers that become executable when conditions align.

**Conceptual Model**: Detection → Interpretation → Presentation → Resolution

1. **Detection** (Pre-legible)
   - System continuously monitors the state space of intents, profiles, and contexts
   - When vector similarity crosses semantic threshold AND trust/timing/value conditions satisfy, an opportunity emerges
   - This is *detection*, not *creation*—opportunities exist latently in the intent graph; agents make them legible

2. **Interpretation** (Legibility)
   - Agent synthesizes *why* this coordination point matters from each party's perspective
   - Uses theory of mind: "What would Alice value about Bob?" vs "What would Bob value about Alice?"
   - Generates dual descriptions that are contextually appropriate, never leaking private intent details
   - This step transforms raw alignment into *legible coordination potential*

3. **Presentation** (Contextual Integrity)
   - Each party receives only their perspective—preserving information boundaries
   - Synthesis addressed as "You" to the recipient, creating first-person relevance
   - Metadata about *how* the opportunity was detected (HyDE strategy, confidence) provides transparency
   - Users understand both *what* is being suggested and *why the system thinks it makes sense*

4. **Resolution** (Lifecycle Management)
   - Opportunities have explicit lifecycle: pending → viewed → accepted/rejected/expired
   - Acceptance triggers connection formation; rejection feeds back to improve future detection
   - Expiration prevents stale coordination: timing window has passed
   - Resolution data trains agent models: which opportunity patterns lead to successful coordination?

**Contextual Integrity via Dual Synthesis**:

The dual-synthesis model is fundamental to preserving privacy while enabling discovery:

- **synthesis** (for source): "You're looking for ML expertise—this person built recommendation systems at scale using transformer models"
- **candidateSynthesis** (for candidate): "You're interested in applied ML—this person is working on a production recommender with challenging cold-start problems"

**Key Properties**:
- **Non-leaking**: Neither description reveals the other party's raw intent text
- **Contextually grounded**: Uses publicly shareable signals (what's in shared indexes, profile data)
- **Asymmetric value**: Explains why connection is valuable *to that specific person*
- **Attributable**: Agent's synthesis is attributed to the system, not the other party

**Key Invariant**: *A party may only see interpretations generated for them by the system. Raw signals (other users' private intents) never cross boundaries. The agent is an interpreter, not a messenger.*

**Why This Matters**: Traditional platforms leak context through UI (showing you someone's exact search query, their profile details before you connect). Index enforces information flow control at the data model level—opportunities carry only agent-synthesized insights, never raw private data.

### Opportunity Detection Patterns

The system supports multiple patterns for surfacing coordination points, each optimized for different discovery modes:

| **Pattern** | **Trigger** | **Search Strategy** | **Example** | **Strategic Function** |
|-------------------|-----------------|---------------------|----------------------------------------------------------------------------|-------------------------------------|
| **Profile Update** | User edits profile | Multi-HyDE (mirror, reciprocal) | "Alice adds 'TypeScript expert' → find projects needing TS" | Real-time capability matching |
| **Intent Created** | New intent posted | Semantic search + index filtering | "Bob posts 'seeking AI mentors' → match with senior ML researchers" | Intent-driven discovery |
| **Cohort Discovery** | Manual trigger or schedule | Clustering + diversity sampling | "Find 5 co-founders for Alice: 2 technical, 2 business, 1 domain expert" | Team formation with diversity |
| **Index-Scoped** | Index membership change | Constrained search within index | "New member joins company index → match with internal collaborators" | Contextual privacy + relevance |
| **HyDE Multi-Strategy** | Profile or intent change | Parallel searches across 6 strategies | "Generate: peers, mentors, mentees, investors, collaborators, hires" | Diverse relationship discovery |
| **Temporal Decay** | Scheduled re-evaluation | Re-score opportunities with time weights | "Opportunities >30 days old decay unless re-confirmed by new signals" | Prevent staleness |
| **Mutual Convergence** | Both parties update profiles | Bidirectional HyDE matching | "Alice seeks ML mentor + Bob seeks mentees → surface to both simultaneously" | High-confidence mutual fits |

**Pattern Composition**: Multiple patterns can execute concurrently. A single profile update might trigger:
1. Profile Update pattern → find immediate matches
2. HyDE Multi-Strategy → explore diverse relationship types
3. Index-Scoped patterns for each index the user belongs to

This creates a rich opportunity space where coordination emerges from multiple angles.

### Agent System Architecture

**Context Brokers**: Event-driven agents that maintain relationships between entities in the system.

**Example: Opportunity Finder as Context Broker**

The Opportunity Finder exemplifies the context broker pattern:

**Trigger**: When a user profile is updated (event-driven)
**Process**:
1. **React**: Detect profile update event
2. **Search**: Use HyDE (Hypothetical Document Embeddings) to find semantically aligned intents
3. **Evaluate**: Assess trust thresholds, timing constraints, and expected value
4. **Surface**: Create opportunity records when coordination conditions align

**Why Context Brokers**: This pattern enables:
- **Decoupled Architecture**: Agents react to events without tight coupling
- **Extensibility**: New context brokers can be added without modifying core systems
- **Scalability**: Async event processing handles high volumes
- **Maintainability**: Each broker has clear responsibility for specific relationships

The system includes multiple graph workflows (Intent, Index, Opportunity, Profile, HyDE, Chat) that orchestrate complex agent operations using LangGraph state machines.

## Semantic Governance System

Index implements a sophisticated intent quality validation system based on **speech act theory** (John Searle) to ensure intents are clear, sincere, and actionable.

### Intent Quality Dimensions

**Semantic Entropy**: Measures intent vagueness using embedding consistency. High entropy intents (ambiguous language, multiple interpretations) trigger elaboration requests for clarification.

**Intent Modes**:
- **REFERENTIAL**: Points to specific entities/people ("looking for John Smith at OpenAI")
- **ATTRIBUTIVE**: Describes desired characteristics ("looking for ML researcher with 5+ years experience")

**Speech Act Types**:
- **COMMISSIVE**: Commits to action ("I will mentor junior developers")
- **DIRECTIVE**: Requests action from others ("seeking investment for my startup")

### Felicity Conditions (Searle's Framework)

Every intent is validated against felicity conditions to ensure it meets social/pragmatic standards:

**1. Authority Condition**: Does the user have standing to make this intent?
- Example: Claiming to represent a company requires verification
- Score: 0-1 (1 = fully authorized)

**2. Sincerity Condition**: Is the intent genuine rather than performative?
- Detected via linguistic markers of commitment vs hedging
- Example: "I'm thinking about maybe possibly looking for..." scores low
- Score: 0-1 (1 = clearly sincere)

**3. Clarity Condition**: Is the intent semantically clear?
- Measured by semantic entropy + referential specificity
- Low clarity triggers elaboration request flow

### Elaboration Request Flow

When an intent fails quality thresholds:

```
High Entropy Intent → Semantic Verifier → Elaboration Request Created → User Clarifies → Re-validation
```

The `elaboration_requests` table tracks interactive refinement cycles:
- Stores original vague intent
- Generates clarifying questions
- Links to refined intent after clarification

**Example**:
- Original: "looking for help with stuff"
- Elaboration: "What specific type of help? What domain/expertise?"
- Refined: "seeking React developer for 3-month contract project"

This ensures the intent graph maintains high-quality, actionable coordination points rather than vague expressions.

### Dynamic Opportunity Graph

Unlike static knowledge graphs with fixed relationships, Index creates **dynamic opportunity graphs** that evolve with user state and context.

**Graph Structure**:
```
Nodes: Users, Intents, Indexes
Edges: Opportunities (weighted by confidence, annotated with detection provenance)
Dynamics: Edges appear/disappear based on real-time conditions
```

**Example Opportunity with Full Context**:
```typescript
const opportunity = {
  id: "opp-7a3f2c",
  indexId: "ai-research-network",
  
  detection: {
    method: "profile_update",
    triggeredBy: "user-a",
    triggeredAt: new Date("2024-01-15T14:23:00Z"),
    hydeStrategies: ["mirror", "collaborator"],
    semanticDistance: 0.82  // High similarity
  },
  
  actors: {
    source: { userId: "user-a", role: "researcher-seeking-collaborator" },
    candidate: { userId: "user-b", role: "researcher-with-complementary-skills" }
  },
  
  interpretation: {
    synthesis: "You're building recommendation systems with cold-start problems. This person recently published research on few-shot learning for recommenders and is actively seeking applied collaboration projects. Their work on contextual bandits directly addresses your user intent sparsity challenges.",
    
    candidateSynthesis: "You're researching few-shot learning applications. This person is building a production recommendation system at scale and struggling with cold-start scenarios—a perfect testbed for your theoretical work. They have infrastructure and data; you have novel algorithms.",
    
    confidence: 87,
    
    reasoning: "High semantic overlap in research interests (recommendation systems, cold-start, few-shot learning). Complementary positions (applied vs theoretical). Timing: both recently active. Mutual benefit: infrastructure+data ↔ algorithms+insights."
  },
  
  context: {
    intentIds: ["intent-a1", "intent-b2"],
    sharedIndexes: ["ai-research-network", "ml-engineering"],
    semanticDistance: 0.82,
    valencyType: "symmetric",  // Both benefit equally
    trustSignals: {
      profileCompleteness: { userA: 0.95, userB: 0.88 },
      indexOverlap: 2,
      mutualConnections: 3
    }
  },
  
  status: "pending",
  lifecycle: {
    createdAt: new Date("2024-01-15T14:23:05Z"),
    expiresAt: new Date("2024-02-15T14:23:05Z")  // 30-day window
  }
}
```

**Ephemeral Structure**: 
- When users connect (status → accepted), the opportunity resolves and new opportunities form around emerging collaborative possibilities
- When timing window closes (expiresAt reached), opportunity expires unless conditions re-align
- This prevents static categorization while enabling dynamic, context-aware discovery

**Graph Dynamics**:
- **Edge Weights**: Confidence scores decay over time unless refreshed by new signals
- **Provenance Tracking**: Each opportunity edge carries metadata about *why* it exists (detection method, HyDE strategies, thresholds satisfied)
- **Feedback Loops**: User actions (view, accept, reject) adjust future opportunity detection thresholds
- **Temporal Evolution**: The graph changes as intents update, profiles evolve, and contexts shift

**Why Dynamic Graphs**: Social coordination isn't static. What makes sense today (e.g., "seeking co-founder") may not tomorrow (e.g., after finding one). Static relationship graphs become stale; dynamic opportunity graphs reflect current coordination potential.

## Discovery and Social Connection Flow

### 1. Content Upload and Intent Generation

```
User uploads files → Index → Intent Inferrer Agent → Suggested Intents
```

When a user uploads files to an index, the Intent Inferrer agent analyzes the content using the Unstructured API for document parsing and intent generation. The agent considers the most likely target audience (e.g., if analyzing a pitch deck, prioritizes investor-focused intents).

**Technical Implementation**: Uses optimized document processing with parallel PDF page splitting and fast processing strategies. Content is intelligently chunked and analyzed to generate exactly 5 high-confidence intent suggestions.

## HyDE Multi-Strategy Architecture

**HyDE (Hypothetical Document Embeddings)** enables sophisticated semantic search by generating hypothetical documents that bridge the gap between what users seek and what exists in the system.

### Core Concept

Instead of directly matching a user's profile to candidate profiles, HyDE generates a hypothetical document representing an ideal match, then searches for profiles similar to that hypothesis.

**Flow**:
```
User Profile → HyDE Generator → Hypothetical Document → Embed → Vector Search → Candidates
```

### Six Search Strategies

Each strategy generates a different type of hypothetical document optimized for specific relationship types:

1. **Mirror Strategy**: "Someone like me"
   - Generates document describing someone with similar background/interests
   - Use case: Find peers, co-founders with complementary skills

2. **Reciprocal Strategy**: "Someone who needs what I offer"
   - Inverse of user's profile—what they can provide, others seek
   - Use case: Find people who would value your expertise

3. **Mentor Strategy**: "Someone more experienced who can guide me"
   - Generates profile of ideal mentor based on user's growth areas
   - Use case: Find advisors, teachers, guides

4. **Investor Strategy**: "Someone who would fund this type of work"
   - Describes ideal investor profile for user's domain/stage
   - Use case: Find funding sources, sponsors

5. **Collaborator Strategy**: "Someone with complementary skills for a project"
   - Identifies skill gaps and generates profile to fill them
   - Use case: Build project teams, find co-creators

6. **Hiree Strategy**: "Someone I could hire or work with"
   - Generates profile of ideal hire/contractor based on needs
   - Use case: Find talent, service providers

### Cache-Aware Generation

**Performance Optimization**: HyDE documents are cached with expiration timestamps:

```typescript
interface HydeDocument {
  sourceId: string;           // User who triggered generation
  sourceType: 'profile' | 'intent' | 'query';
  strategy: 'mirror' | 'reciprocal' | 'mentor' | 'investor' | 'collaborator' | 'hiree';
  targetCorpus: 'profiles' | 'intents';
  hydeEmbedding: number[];    // 2000-dim vector
  expiresAt: Date | null;     // Cache expiration
}
```

**Cache Flow**:
1. Check cache for existing HyDE document matching strategy
2. If cached and not expired, use existing embedding
3. If missing or expired, generate new document and embed
4. Store with expiration (typically 24-48 hours)

This reduces LLM calls and maintains consistency across multiple searches within a session.

### Integration with Opportunity Detection

The Opportunity Graph uses HyDE strategies to find candidates:

```
Profile Update → Opportunity Graph → HyDE Generator (multiple strategies) → 
Vector Search → Candidate Pool → Opportunity Evaluator → Opportunities
```

Multiple strategies can run in parallel to find diverse types of connections (peers, mentors, collaborators) from a single trigger.

### Planned: Data Clean Room Architecture

**Future Architecture**: The privacy guarantees will follow established patterns from advertising technology's **data clean rooms**. In the planned TEE deployment:

```
Encrypted Intent Data → TEE Processing Environment → Limited Agent Actions → Opportunity Signals Only
```

Agents will only output **opportunity descriptions** and **confidence scores** to users. The actual intent content of other users will remain encrypted and inaccessible outside the confidential compute network. This creates a "privacy superhighway" where agents prove their identity through TEE attestation to gain permissioned access, but can only share derived insights (synthesized descriptions), never raw data.

**Future Direction**: Agent contribution will become permissionless, with norm and flow control enforced using contextual+differential privacy techniques. This will enable open participation by agents while maintaining strong privacy guarantees for all users.


### 3. Agent-Mediated Connections

```
Profile Updated → Opportunity Graph → Candidate Search → Opportunity Evaluation → Opportunities Surfaced
```

The Opportunity Graph orchestrates the discovery process:
1. **Resolve Source Profile**: Load the user's profile context
2. **Search Candidates**: Use vector similarity to find potential matches
3. **Evaluate Candidates**: The Opportunity Evaluator agent analyzes each candidate and produces scored opportunities with dual descriptions


### 3. Agent-Mediated Discovery

```
Profile Updated → Opportunity Detection → HyDE Search → Candidate Evaluation → Opportunities Surfaced
```

The Opportunity Graph orchestrates the discovery process:
1. **Detect Trigger**: Profile update or intent creation event
2. **Search Candidates**: Use HyDE strategies for semantic search
3. **Evaluate Alignment**: Assess trust, timing, and value thresholds
4. **Surface Opportunities**: Create coordination point records when conditions align

## API Architecture

### RESTful Interface

The protocol exposes a comprehensive REST API via a Bun.serve server on port 3001. The server uses decorator-based routing with `@Controller`, `@Get`, `@Post` annotations.

**Authentication**: All endpoints require Bearer token authentication (Privy JWT):
```typescript
Authorization: Bearer YOUR_API_TOKEN
```

**Core API Endpoints**:

**Intent Management**:
```typescript
// Process user input through Intent Graph (create/update/delete intents)
POST /intents/process
{
  "input": "Looking for ML researchers...",
  "mode": "create" | "update" | "delete",
  "indexId": "index-ai-research"
}

// List intents with pagination
POST /intents/list
{
  "page": 1,
  "limit": 20,
  "archived": false
}

// Get single intent
GET /intents/{id}

// Archive intent
PATCH /intents/{id}/archive
```

**Index Management**:
```typescript
// Create index
POST /indexes
{
  "title": "AI Research Network",
  "prompt": "Looking for AI/ML collaborators",
  "joinPolicy": "invite_only" | "anyone"
}

// Update index
PUT /indexes/{id}

// Add/remove members
POST /indexes/{id}/members
DELETE /indexes/{id}/members/{memberId}

// Get public indexes (discovery)
GET /indexes/discovery/public

// Join public index
POST /indexes/{id}/join
```

**Opportunity Discovery**:
```typescript
// List opportunities for authenticated user
GET /opportunities

// Get opportunity with presentation
GET /opportunities/{id}

// Update opportunity status
PATCH /opportunities/{id}/status
{
  "status": "viewed" | "accepted" | "rejected"
}

// Discover opportunities via HyDE graph
POST /opportunities/discover
{
  "query": "ML researchers interested in recommendation systems",
  "limit": 10
}

// Index-scoped opportunities
GET /indexes/{indexId}/opportunities
POST /indexes/{indexId}/opportunities
```

**File & Link Processing**:
```typescript
// Upload file
POST /files
// FormData with file attachment

// Upload to library
POST /uploads

// Create crawlable link
POST /links
{
  "url": "https://example.com/paper.pdf"
}

// Get link content
GET /links/{id}/content
```

**Chat Interface**:
```typescript
// Send message to chat graph (ReAct agent loop)
POST /chat/message
{
  "sessionId": "session-123",
  "message": "Find me ML collaborators"
}

// Stream chat responses (SSE)
POST /chat/stream

// Get chat sessions
GET /chat/sessions

// Get session with messages
POST /chat/session
{
  "sessionId": "session-123"
}

// Generate Stream Chat token
POST /chat/token
```

**Profile Management**:
```typescript
// Sync/generate user profile
POST /profiles/sync
```

**Server Architecture**: The server uses Bun.serve (not Express) with decorator-based routing via `RouteRegistry`. Controllers are registered with `@Controller(prefix)` and routes with `@Get/@Post/@Patch/@Put/@Delete`. Guards like `@UseGuards(AuthGuard)` handle authentication.

### Future Integrations

**XMTP (Planned)**: The protocol architecture includes plans for **XMTP (Extensible Message Transport Protocol)** integration as a decentralized messaging layer.

**Why XMTP**:
- **Decentralized Communication**: End-to-end encrypted messaging without centralized servers
- **Wallet-Based Identity**: Leverages Ethereum addresses for authentication
- **Cross-Platform**: Messages accessible across any XMTP-compatible client
- **Privacy Alignment**: Complements TEE deployment for fully private coordination

**Planned Architecture**:
```
Opportunity Detected → XMTP Message → Recipient's Wallet → Cross-Platform Notification
```

XMTP will enable:
- Direct encrypted communication between matched users
- Wallet-to-wallet coordination without platform lock-in
- Portable conversation history owned by users
- Integration with Web3 identity and reputation systems

This positions Index as a **coordination protocol** rather than a walled platform—opportunities surface connections, XMTP enables portable communication, and users retain full data ownership.

## Connection and Discovery Workflow

### Connection State Machine

```typescript
type ConnectionAction = 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE';

// State transitions
null → REQUEST → {ACCEPT, DECLINE, SKIP, CANCEL}
DECLINE/SKIP → REQUEST (can try again)
ACCEPT → [connected]
```

**Why explicit state management**: Future decentralized coordination will require immutable communication about consents. The explicit state for connections prevents ambiguity and enables coordination integrity. Currently implemented in PostgreSQL with the same state machine logic to prepare for decentralized operation.


## Scalability and Performance Considerations

### Database Design for Scale

**Opportunities as First-Class Entities**: Each opportunity is stored as a complete record linking two users with scored, role-aware descriptions:

```sql
-- Find pending opportunities for a user
SELECT * FROM opportunities 
WHERE source_id = 'user-id' AND status = 'PENDING'
ORDER BY score DESC;

-- Find mutual opportunities (where both parties have opportunities surfaced)
SELECT o1.* FROM opportunities o1
JOIN opportunities o2 ON o1.source_id = o2.candidate_id AND o1.candidate_id = o2.source_id
WHERE o1.status = 'PENDING';
```

### Agent Processing Architecture

**Asynchronous Opportunity Processing**: The Opportunity Graph processes candidate evaluations asynchronously, preventing any single evaluation from blocking the pipeline. The graph is instantiated with database, embedder, cache, and a compiled HyDE graph; you call `compile()` to get the runnable, then `invoke(initialState)` with state that includes `sourceUserId`, optional `indexScope`, and options. See `protocol/src/lib/protocol/graphs/opportunity/README.md` for the full API.
