# Index Network: Technical Architecture

## Overview

Index Network is a discovery protocol that fundamentally reimagines how people connect online. Instead of profile-based social networks where identity drives discovery, Index operates on an **intent-driven model** where users express what they're seeking, and AI agents facilitate connections based on semantic understanding and contextual relevance.

By centering discovery on **indexes** (privacy-controlled intent collections) and **intents** (open-ended expressions of what someone seeks), Index enables a more efficent, private, and personal way for people to connect.

**Current Implementation**: The protocol is currently implemented as a centralized system using PostgreSQL for all data storage and application-layer privacy controls. The architecture is designed with decentralization compatibility in mind, enabling future migration to off-chain storage, confidential compute environments, and token-based economic mechanisms when the protocol transitions to decentralized operation.

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
- `owner`: Full access (manage members, settings, read/write intents, run vibe checks)
- `admin`: Can manage members (except owners) and settings
- `member`: Standard access (read/write intents, run vibe checks)

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

### Scalable Intent Storage

**Current Implementation**: Intents are stored in PostgreSQL with a design optimized for future migration to **off-chain** storage with **on-chain finality** using a hash and roll-up architecture. This future approach will enable:

- **Peer-to-Peer Discovery**: Agents enable direct, programmable discovery without intermediaries
- **Programmable Incentives**: Agents can deploy custom incentive logic at the protocol layer, so that each element remains connected to the value layer.
- **Privacy**: Raw intent data never leaves confidential compute; not exposed on public chains
- **Integrity**: Cryptographic proofs guarantee data authenticity
- **Performance**: Fast, low-latency queries without blockchain bottlenecks

**Privacy Architecture**: The protocol is designed for intents to be **only accessible to agents running in confidential compute environments**. The agent runtime will maintain the storage and retrieval of intents that hosted exclusively within TEE-protected infrastructure. No intent data will be exposed to:
- Public networks or APIs
- User interfaces directly
- Non-TEE computational environments
- Third-party systems

Users can access their own intent data through standard interfaces, but agents query the protected database using natural language within the confidential compute network when analyzing cross-user relationships. When agents find matches, they share **only their reasoning and confidence scores** with users through contextually private interfaces - never the raw intent data of other users.

### Why This Separation

The separation between intents and indexes serves a crucial strategic purpose: **context isolation for privacy management**. This architectural decision enables users to share different aspects of their intents in different contexts.

Context isolation makes privacy management practical and intuitive. A researcher can share academic papers in one index, startup ideas in another, and consulting availability in a third – each with appropriate audiences and permissions. This prevents the "all-or-nothing" privacy problem of traditional platforms where you either share everything or nothing.

## Agent Runtime Architecture

### Opportunity Discovery

The Opportunity system is the intelligence layer that surfaces potential connections between users:

```typescript
interface Opportunity {
  sourceId: string;           // User we're finding opportunities FOR
  candidateId: string;        // Potential match
  score: number;              // Relevance score (0-100)
  sourceDescription: string;  // Why valuable TO the source
  candidateDescription: string; // Why valuable TO the candidate
  valencyRole: 'Agent' | 'Patient' | 'Peer';
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}
```

**Current Implementation**:

**Opportunity Evaluator**: An LLM-based agent that analyzes a source user's profile against candidate profiles to identify high-value connection opportunities. The evaluator produces dual descriptions—one written for each party—ensuring contextual integrity is preserved.

**Valency Analysis**: The agent determines the semantic role of each party:
- **Agent**: The candidate CAN DO something for the source
- **Patient**: The candidate NEEDS something from the source  
- **Peer**: Symmetric collaboration potential

**Why this architecture**: The dual-description model ensures that each party only sees information relevant to them, never leaking the other party's private intents. This creates trust through transparency while maintaining privacy.

### Opportunities as Coordination Primitives

Opportunities are the fundamental unit of potential coordination in Index. An opportunity represents a detected possibility for meaningful connection, existing before any agreement, conversation, or commitment.

**Conceptual Model**: Signal → Interpretation → Projection

1. **Signal**: Raw coordination potential detected by agents (pre-legible, pre-consent)
2. **Interpretation**: A subjective reading of the signal, always owned by one party
3. **Projection**: An interpretation offered to another party, attributed to the sender

```typescript
interface Opportunity {
  id: string;
  sourceId: string;              // User for whom this opportunity was surfaced
  candidateId: string;           // The potential connection
  score: number;                 // Confidence score (0-100)
  sourceDescription: string;     // Written FOR the source user
  candidateDescription: string;  // Written FOR the candidate user
  valencyRole: 'Agent' | 'Patient' | 'Peer';
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}
```

**Contextual Integrity**: The dual-description model is fundamental to preserving contextual integrity:
- **sourceDescription**: Explains why this connection is valuable to the source, addressed as "You"
- **candidateDescription**: Explains why this connection is valuable to the candidate, addressed as "You"
- Neither description leaks the other party's private intents

**Key Invariant**: *A party may only transmit interpretations they own; signals and third-party interpretations never cross boundaries.*

**Strategic Design**: Opportunities serve multiple purposes:
- **Explainability**: Each party understands why they're being connected
- **Privacy**: Intent details remain private; only agent-synthesized descriptions are shared
- **Quality Control**: Agents build reputation based on opportunity acceptance rates
- **Economic Incentives**: Future token mechanics can reward successful connections

### Multi-Layer Quality Control

Index implements several mechanisms to ensure match quality and prevent abuse:

### Opportunity Patterns in Index

The system supports multiple opportunity patterns that enable different types of discovery and community formation:

| **Pattern** | **Description** | **Example** | **Strategic Function** |
|-------------------|------------------------------------------------------------------|----------------------------------------------------------------------------|-------------------------------------|
| **1:1 Direct** | One agent surfaces an opportunity between two users | "Connect Alice with Bob" | Precision matchmaking |
| **1:n Fan-out** | One agent surfaces multiple opportunities for a single user | "Suggest cofounders to Alice" | Personalized recommendations |
| **n:1 Convergence** | Multiple agents identify the same candidate for one user | "Multiple agents suggest Bob to Alice" | Compounding confidence signal |
| **Cohort** | Agent identifies a group of related opportunities | "Build a collaborator cohort for Alice's startup" | Community curation |
| **Broadcast** | One agent surfaces the same candidate to multiple seekers | "Suggest Bob to 5 people looking for AI collaborators" | Demand-side liquidity |
| **Multi-perspective** | Different agents evaluate the same pair on different dimensions | "Trust agent + skill agent + context agent all evaluate Alice↔Bob" | Composite opportunity scoring |

These patterns enable Index to scale from individual connections to community-wide discovery while maintaining explainability and agent accountability.

### Programmable Discovery Markets

Index makes discovery markets programmable—allowing anyone to define new economic rules and connection strategies over intents. The future of social coordination is shaped by how these programmable markets are composed, forked, and remixed to surface new forms of connection.

**Customizable Market Logic**: Agents and communities will be able to launch their own discovery markets, each with unique scoring and reward mechanisms. For example, some markets may incentivize risk-taking and novel connections, while others optimize for domain-specific expertise.

**Exploration-Driven Incentives**: By supporting mechanisms like logarithmic market scoring rules, these markets can dynamically adjust the "price" of matches. As common connections become saturated, agents are nudged to explore the long tail—surfacing niche, underexplored relationships that might otherwise be missed.

This architecture enables an exciting future where the very logic of discovery is open, remixable, and shaped by the needs and creativity of its participants.

**Multiple Market Perspectives**: The same user pool can support multiple discovery markets with different strategies:
- **Exploration markets**: Reward novel, serendipitous connections  
- **Domain-specific markets**: Optimize for particular industries or contexts

As Index Network grows, the combinatorial explosion of potential connections creates a rich discovery space where specialized "opportunity miners" - agents optimized for finding specific types of valuable connections - can carve out profitable niches.

### Core Processing Agents

**Intent Inferrer**: Analyzes uploaded files and generates suggested intents
```typescript
analyzeFolder(folderPath: string, fileIds: string[]) 
  → InferredIntent[] // high-confidence intent suggestions
```

**Intent Summarizer**: Creates concise summaries for storage and display
```typescript
summarizeIntent(text: string, maxLength: number) 
  → Summary // Condensed version maintaining key meaning
```

**Why this separation**: Separating agents enables both individualistic and social discovery. While each agent maintains context isolation for privacy and clear separation of concerns, this architecture naturally supports multi-user entities that represent communities, organizations, and networks as they exist in society - creating digital "4th spaces" for discovery.

Indexes can be used for:
- **Individuals**: Personal indexes that can be used for sharing, organisation.
- **Group**: Community or organizational indexes that represent mutual intentions.
- **Network**: Mutual intentions among inter-group connections.

This simple approach mirrors how we naturally navigate social spaces - we have individual preferences while also being part of communities, organizations, and networks that have their own social dynamics. Each agent accesses only the relevant data needed for its integrity, enabling rich user-centric discovery while maintaining social privacy expectations.

### Dynamic Opportunity Graph

Unlike traditional knowledge graphs with fixed relationships, Index creates **situational opportunity graphs** that emerge from agent evaluations:

```typescript
// An opportunity between two users, with role-aware descriptions
const opportunity = {
  sourceId: "user-a",
  candidateId: "user-b",
  score: 85,
  valencyRole: "Agent", // user-b CAN DO something for user-a
  sourceDescription: "You're looking for ML expertise—this person built recommendation systems at scale",
  candidateDescription: "You're interested in applied ML—this person is working on a challenging recommendation problem",
  status: "PENDING"
}
```

**Ephemeral Structure**: When users connect, the opportunity resolves, and new opportunities form around emerging possibilities. This prevents static categorization while enabling dynamic, context-aware discovery.

**Contextual Integrity**: The dual-description model ensures each party receives information relevant to them without exposing the other party's private context. The agent synthesizes—never copies—creating interpretations that respect boundaries while surfacing value.

## Discovery and Social Connection Flow

### 1. Content Upload and Intent Generation

```
User uploads files → Index → Intent Inferrer Agent → Suggested Intents
```

When a user uploads files to an index, the Intent Inferrer agent analyzes the content using the Unstructured API for document parsing and intent generation. The agent considers the most likely target audience (e.g., if analyzing a pitch deck, prioritizes investor-focused intents).

**Technical Implementation**: Uses optimized document processing with parallel PDF page splitting and fast processing strategies. Content is intelligently chunked and analyzed to generate exactly 5 high-confidence intent suggestions.

### Data Clean Room Architecture

**Future Architecture**: The privacy guarantees will follow established patterns from advertising technology's **data clean rooms**. In the planned architecture:

```
Encrypted Intent Data → TEE Processing Environment → Limited Agent Actions → Opportunity Signals Only
```

Agents can only output **opportunity descriptions** and **confidence scores** to users. The actual intent content of other users remains encrypted and inaccessible outside the confidential compute network. This creates a "privacy superhighway" where agents prove their identity through TEE attestation to gain permissioned access, but can only share derived insights (synthesized descriptions), never raw data.

**Future Direction**: Agent contribution will become permissionless, with norm and flow control enforced using contextual+differential privacy techniques. This will enable open participation by agents while maintaining strong privacy guarantees for all users.


### 3. Agent-Mediated Connections

```
Profile Updated → Opportunity Graph → Candidate Search → Opportunity Evaluation → Opportunities Surfaced
```

The Opportunity Graph orchestrates the discovery process:
1. **Resolve Source Profile**: Load the user's profile context
2. **Search Candidates**: Use vector similarity to find potential matches
3. **Evaluate Candidates**: The Opportunity Evaluator agent analyzes each candidate and produces scored opportunities with dual descriptions


## Communication and Synthesis Layer

Index automatically generates contextual communications:

**Connection Requests**: Include AI-generated "What Could Happen Here" synthesis
**Connection Acceptance**: Include AI-generated introduction text based on the opportunity context

```typescript
// Vibe checking: What could this collaboration look like?
synthesizeVibeCheck(targetUserId, contextUserId) → collaboration_potential

// Introduction synthesis: Why these people should connect  
synthesizeIntro(senderUserId, recipientUserId) → introduction_text
```


**Contextual Privacy in Communication**: All automatically generated communications are based on:
- Agent reasoning and explanations (discoverable with contextually relevant people)
- Synthesis narratives derived from agent insights
- General collaboration potential assessments

**Never included**: Raw intent content, private file details, or specific personal information from other users. Index maintains privacy while providing meaningful context for why connections might be valuable.


## API Architecture

### RESTful Interface

The protocol exposes a comprehensive REST API that enables developers to integrate Index functionality into their applications:

**Authentication**: All endpoints require Bearer token authentication:
```typescript
Authorization: Bearer YOUR_API_TOKEN
```

**Core API Endpoints**:

**Intent Management**:
```typescript
// Create intent
POST /api/intents
{
  "payload": "Looking for ML researchers to collaborate on AI research...",
  "isIncognito": false,
  "indexIds": ["index-ai-research"]  // References Intent.indexes relationship
}

// Get intents with filtering
GET /api/intents?page=1&limit=20&archived=false

// Update intent
PUT /api/intents/{id}
{
  "payload": "Updated intent description",
  "isIncognito": true
}
```

**Index Management**:
```typescript
// Create index
POST /api/indexes
{
  "title": "AI Research Network"
}

// Add member with permissions
POST /api/indexes/{id}/members
{
  "userId": "user-456",
  "permissions": ["member"]
}
```

**File Processing**:
```typescript
// Upload files for intent generation
POST /api/files
// FormData with file attachment
```

**Discovery and Connections**:
```typescript
// Get opportunities surfaced for the user
GET /api/opportunities?status=PENDING

// Get discovery results for shared index
GET /api/discover/{indexCode}
```

**Conversational Agents**: Index also supports conversational integrations for platforms like Slack, Discord, and other chat environments, enabling intent inference and matchmaking within existing communication workflows.

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
