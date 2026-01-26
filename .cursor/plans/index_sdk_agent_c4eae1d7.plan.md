---
name: Index SDK Agent
overview: Create a standalone SDK-style library for the Index opportunity system, with a separate reasoning agent that uses the SDK to navigate users, intents, and opportunities.
todos:
  - id: sdk-types
    content: Create sdk/types.ts with Bio, Intent, Opportunity, etc.
    status: pending
  - id: sdk-users
    content: Create sdk/users.ts with get() and hyde()
    status: pending
    dependencies:
      - sdk-types
  - id: sdk-intents
    content: Create sdk/intents.ts with list(), mutual(), infer()
    status: pending
    dependencies:
      - sdk-types
  - id: sdk-opportunities
    content: Create sdk/opportunities.ts with between() and synthesis()
    status: pending
    dependencies:
      - sdk-types
  - id: sdk-discover
    content: Create sdk/discover.ts with run()
    status: pending
    dependencies:
      - sdk-types
  - id: sdk-index
    content: Create sdk/index.ts as main entry point
    status: pending
    dependencies:
      - sdk-users
      - sdk-intents
      - sdk-opportunities
      - sdk-discover
  - id: agent-types
    content: Create agents/index/index.agent.types.ts
    status: pending
    dependencies:
      - sdk-index
  - id: agent-impl
    content: Create agents/index/index.agent.ts with run() and reason()
    status: pending
    dependencies:
      - agent-types
---

# Index SDK + Agent

## Architecture

```
protocol/src/
├── sdk/                          # The SDK (data access)
│   ├── index.ts                  # Main export
│   ├── types.ts                  # All types
│   ├── users.ts                  # users.*
│   ├── intents.ts                # intents.*
│   ├── opportunities.ts          # opportunities.*
│   └── discover.ts               # discover.*
│
└── agents/
    └── index/                    # The Agent (reasoning)
        ├── index.agent.ts        # Main agent
        └── index.agent.types.ts  # Agent types
```

## The SDK

### Entry Point: `sdk/index.ts`

```typescript
import { Users } from './users';
import { Intents } from './intents';
import { Opportunities } from './opportunities';
import { Discover } from './discover';

export class IndexSDK {
  readonly users: Users;
  readonly intents: Intents;
  readonly opportunities: Opportunities;
  readonly discover: Discover;

  constructor() {
    this.users = new Users();
    this.intents = new Intents();
    this.opportunities = new Opportunities();
    this.discover = new Discover();
  }
}

export const index = new IndexSDK();
export * from './types';
```

---

### `sdk/types.ts`

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// USER TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Bio {
  userId: string;
  name: string;
  bio: string;
  location?: string;
  interests: string[];
  skills: string[];
  context?: string;
}

export interface HyDE {
  description: string;
  embedding?: number[];
}

// ═══════════════════════════════════════════════════════════════════════════
// INTENT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Intent {
  id: string;
  userId: string;
  payload: string;
  summary?: string;
  confidence: number;
  sourceType?: string;
  createdAt: Date;
}

export interface MutualIntent {
  intentA: Intent;
  intentB: Intent;
  similarity: number;
}

export interface ImplicitIntent {
  payload: string;
  confidence: number;
  reasoning: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// OPPORTUNITY TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Opportunity {
  type: 'collaboration' | 'mentorship' | 'networking' | 'other';
  title: string;
  description: string;
  score: number;
  candidateId: string;
}

export interface Synthesis {
  subject: string;
  body: string;
}

export interface DiscoveredMatch {
  user: Bio;
  opportunity: Opportunity;
}
```

---

### `sdk/users.ts`

```typescript
import db from '../lib/db';
import { userProfiles } from '../lib/schema';
import { eq } from 'drizzle-orm';
import { HydeGeneratorAgent } from '../agents/profile/hyde/hyde.generator';
import { IndexEmbedder } from '../lib/embedder';
import { Bio, HyDE } from './types';

export class Users {
  private embedder = new IndexEmbedder();

  /**
   * Get user bio/profile
   */
  async get(userId: string): Promise<Bio | null> {
    const [profile] = await db.select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    if (!profile) return null;

    return {
      userId: profile.userId,
      name: profile.identity?.name || '',
      bio: profile.identity?.bio || '',
      location: profile.identity?.location,
      interests: profile.attributes?.interests || [],
      skills: profile.attributes?.skills || [],
      context: profile.narrative?.context
    };
  }

  /**
   * Generate HyDE (ideal match description) for user
   */
  async hyde(userId: string, instruction?: string): Promise<HyDE | null> {
    const bio = await this.get(userId);
    if (!bio) return null;

    const generator = new HydeGeneratorAgent(this.embedder);
    const profileContext = `
      Bio: ${bio.bio}
      Location: ${bio.location || ''}
      Interests: ${bio.interests.join(', ')}
      Skills: ${bio.skills.join(', ')}
      Context: ${bio.context || ''}
    `;

    const result = await generator.generate(profileContext, { instruction });
    if (!result?.description) return null;

    return {
      description: result.description,
      embedding: result.embedding
    };
  }
}
```

---

### `sdk/intents.ts`

```typescript
import db from '../lib/db';
import { intents } from '../lib/schema';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { ImplicitInferrer } from '../agents/intent/inferrer/implicit/implicit.inferrer';
import { Intent, MutualIntent, ImplicitIntent } from './types';

export class Intents {
  /**
   * List user's active intents
   */
  async list(userId: string, options?: { limit?: number }): Promise<Intent[]> {
    const limit = options?.limit || 20;
    
    const rows = await db.select()
      .from(intents)
      .where(and(
        eq(intents.userId, userId),
        isNull(intents.archivedAt)
      ))
      .orderBy(desc(intents.createdAt))
      .limit(limit);

    return rows.map(r => ({
      id: r.id,
      userId: r.userId,
      payload: r.payload,
      summary: r.summary,
      confidence: r.confidence || 1,
      sourceType: r.sourceType,
      createdAt: r.createdAt
    }));
  }

  /**
   * Find mutual intents between two users
   */
  async mutual(userA: string, userB: string, options?: { 
    minSimilarity?: number;
    limit?: number;
  }): Promise<MutualIntent[]> {
    const minSim = options?.minSimilarity || 0.5;
    const limit = options?.limit || 10;

    // Get intents with embeddings for both users
    const intentsA = await db.select()
      .from(intents)
      .where(and(eq(intents.userId, userA), isNull(intents.archivedAt)));

    const intentsB = await db.select()
      .from(intents)
      .where(and(eq(intents.userId, userB), isNull(intents.archivedAt)));

    const pairs: MutualIntent[] = [];

    for (const a of intentsA) {
      if (!a.embedding) continue;
      for (const b of intentsB) {
        if (!b.embedding) continue;

        // Calculate cosine similarity
        const result = await db.execute(sql`
          SELECT 1 - (${JSON.stringify(a.embedding)}::vector <=> 
                      ${JSON.stringify(b.embedding)}::vector) as similarity
        `);
        
        const similarity = Number(result[0]?.similarity || 0);
        if (similarity >= minSim) {
          pairs.push({
            intentA: { id: a.id, userId: a.userId, payload: a.payload, 
                       summary: a.summary, confidence: 1, createdAt: a.createdAt },
            intentB: { id: b.id, userId: b.userId, payload: b.payload,
                       summary: b.summary, confidence: 1, createdAt: b.createdAt },
            similarity
          });
        }
      }
    }

    return pairs
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Infer implicit intent from context
   */
  async infer(userId: string, context: string): Promise<ImplicitIntent | null> {
    const inferrer = new ImplicitInferrer();
    
    // Get user profile context
    const profile = await db.select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    if (!profile.length) return null;

    const profileContext = JSON.stringify(profile[0]);
    const result = await inferrer.run(profileContext, context);
    
    if (!result) return null;

    return {
      payload: result.payload,
      confidence: result.confidence,
      reasoning: result.reasoning || ''
    };
  }
}
```

---

### `sdk/opportunities.ts`

```typescript
import { OpportunityService } from '../services/opportunity.service';
import { SynthesisGenerator } from '../agents/intent/stake/synthesis/synthesis.generator';
import { getConnectingStakes, stakeBuildPairs } from '../lib/stakes';
import { Opportunity, Synthesis } from './types';

export class Opportunities {
  private service = new OpportunityService();

  /**
   * Find opportunities between two users
   */
  async between(userA: string, userB: string): Promise<Opportunity[]> {
    // Use OpportunityEvaluator to analyze the pair
    const profileA = await this.service.getProfile(userA);
    const profileB = await this.service.getProfile(userB);
    
    if (!profileA || !profileB) return [];

    // Get existing opportunities from stakes
    const stakes = await getConnectingStakes({
      authenticatedUserId: userA,
      userIds: [userA, userB],
      requireAllUsers: true,
      limit: 10
    });

    return stakes.map(s => ({
      type: 'collaboration' as const,
      title: s.reasoning?.split('.')[0] || 'Potential collaboration',
      description: s.reasoning || '',
      score: Number(s.stake),
      candidateId: userB
    }));
  }

  /**
   * Generate synthesis (why they should connect)
   */
  async synthesis(userA: string, userB: string): Promise<Synthesis | null> {
    const stakes = await getConnectingStakes({
      authenticatedUserId: userA,
      userIds: [userA, userB],
      requireAllUsers: true,
      limit: 3
    });

    if (!stakes.length) return null;

    const pairs = stakes.flatMap(s => stakeBuildPairs(s, userA, userB));
    if (!pairs.length) return null;

    const generator = new SynthesisGenerator();
    const result = await generator.run({
      initiatorId: userA,
      targetId: userB,
      intentPairs: pairs
    });

    return {
      subject: result.subject || '',
      body: result.synthesis || ''
    };
  }
}
```

---

### `sdk/discover.ts`

```typescript
import { OpportunityService } from '../services/opportunity.service';
import { Bio, DiscoveredMatch } from './types';

export class Discover {
  private service = new OpportunityService();

  /**
   * Discover matches using natural language
   */
  async run(prompt: string, options?: {
    for?: string;
    limit?: number;
    minScore?: number;
  }): Promise<DiscoveredMatch[]> {
    const userId = options?.for;
    if (!userId) {
      throw new Error('discover.run requires "for" option with userId');
    }

    const results = await this.service.discoverOpportunitiesWithPrompt({
      prompt,
      memberIds: [userId],
      limit: options?.limit || 10
    });

    return results.map(r => ({
      user: {
        userId: r.targetUser.id,
        name: r.targetUser.name,
        bio: '',
        interests: [],
        skills: []
      },
      opportunity: {
        type: r.opportunity.type,
        title: r.opportunity.title,
        description: r.opportunity.description,
        score: r.opportunity.score,
        candidateId: r.targetUser.id
      }
    }));
  }
}
```

---

## The Agent

### `agents/index/index.agent.ts`

```typescript
import { BaseLangChainAgent, createAgent } from '../../lib/langchain/langchain';
import { z } from 'zod';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { index } from '../../sdk';
import { IndexAgentInput, IndexAgentOutput } from './index.agent.types';

const SYSTEM_PROMPT = `
You are the Index Agent - an AI that helps users navigate opportunities and connections.

You have access to the Index SDK with these capabilities:
- index.users.get(id) - Get user bio/profile
- index.users.hyde(id, instruction?) - Generate ideal match description
- index.intents.list(id) - Get user's active intents
- index.intents.mutual(a, b) - Find shared intents between users
- index.intents.infer(id, context) - Infer implicit intent from context
- index.opportunities.between(a, b) - Find opportunities between users
- index.opportunities.synthesis(a, b) - Generate connection explanation
- index.discover.run(prompt, { for: userId }) - Semantic search for matches

CONTEXTUAL INTEGRITY:
When reasoning about connections, consider:
- Intent: Does this align with their goals?
- Relevancy: Does it matter to them now?
- Value: Is it worth their time?
- Appropriateness: What should NOT be shared?
- Trust: Is this reliable?
- Time: Is timing relevant?

Always explain your reasoning. Be specific about why connections are valuable.
`;

const OutputSchema = z.object({
  answer: z.string().describe('The response to the user query'),
  reasoning: z.string().describe('Explanation of the reasoning process'),
  actions: z.array(z.object({
    tool: z.string(),
    input: z.any(),
    result: z.any().optional()
  })).describe('SDK calls made to gather information'),
  confidence: z.number().min(0).max(100)
});

export class IndexAgent extends BaseLangChainAgent {
  constructor() {
    super({
      preset: 'index-agent',
      responseFormat: OutputSchema,
      temperature: 0.3
    });
  }

  /**
   * Process a query about users, intents, or opportunities
   */
  async run(input: IndexAgentInput): Promise<IndexAgentOutput> {
    const { query, context } = input;

    // Build context string from provided data
    const contextString = context 
      ? `\nCONTEXT:\n${JSON.stringify(context, null, 2)}`
      : '';

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(`${query}${contextString}`)
    ];

    const result = await this.model.invoke(messages);
    return result.structuredResponse as IndexAgentOutput;
  }

  /**
   * Reason about provided data
   */
  async reason(question: string, data: Record<string, any>): Promise<IndexAgentOutput> {
    return this.run({ 
      query: question, 
      context: data 
    });
  }
}

export const indexAgent = new IndexAgent();
```

---

### `agents/index/index.agent.types.ts`

```typescript
export interface IndexAgentInput {
  query: string;
  context?: Record<string, any>;
}

export interface IndexAgentAction {
  tool: string;
  input: any;
  result?: any;
}

export interface IndexAgentOutput {
  answer: string;
  reasoning: string;
  actions: IndexAgentAction[];
  confidence: number;
}
```

---

## Usage Examples

```typescript
import { index } from './sdk';
import { indexAgent } from './agents/index/index.agent';

// ═══════════════════════════════════════════════════════════════════════════
// SDK USAGE (Direct data access)
// ═══════════════════════════════════════════════════════════════════════════

// Get user info
const alice = await index.users.get("alice");
const intents = await index.intents.list("alice");

// Find what two users share
const mutual = await index.intents.mutual("alice", "bob");
const synthesis = await index.opportunities.synthesis("alice", "bob");

// Discover matches
const matches = await index.discover.run("AI researchers", { for: "alice" });

// ═══════════════════════════════════════════════════════════════════════════
// AGENT USAGE (Reasoning over data)
// ═══════════════════════════════════════════════════════════════════════════

// Simple query
const response = await indexAgent.run({
  query: "Who should Alice meet?"
});

// Reason about fetched data
const alice = await index.users.get("alice");
const bob = await index.users.get("bob");
const mutual = await index.intents.mutual("alice", "bob");

const insight = await indexAgent.reason(
  "Should I introduce Alice to Bob? Why or why not?",
  { alice, bob, mutual }
);

// Complex reasoning
const matches = await index.discover.run("investors", { for: "alice" });
const ranked = await indexAgent.reason(
  "Rank these matches by likelihood of success",
  { alice: await index.users.get("alice"), matches }
);
```

---

## File Structure

```
protocol/src/
├── sdk/
│   ├── index.ts           # Export: index
│   ├── types.ts           # All SDK types
│   ├── users.ts           # index.users.*
│   ├── intents.ts         # index.intents.*
│   ├── opportunities.ts   # index.opportunities.*
│   └── discover.ts        # index.discover.*
│
└── agents/
    └── index/
        ├── index.agent.ts       # Export: indexAgent
        └── index.agent.types.ts # Agent types
```