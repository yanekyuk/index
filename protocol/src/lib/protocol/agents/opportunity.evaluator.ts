import { ChatOpenAI } from "@langchain/openai";
import type { Runnable } from "@langchain/core/runnables";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { protocolLogger } from "../support/protocol.logger";
import type { HydeStrategy } from "./hyde.strategies";
import type { OpportunityStatus } from "../interfaces/database.interface";

const logger = protocolLogger("OpportunityEvaluator");

/**
 * Config
 */
import { config } from "dotenv";
config({ path: '.env.development' });

const model = new ChatOpenAI({
  model: 'google/gemini-2.5-flash',
  configuration: { baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY }
});

// ──────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────


const systemPrompt = `
    You are an expert "Opportunity Matcher" and super-connector.
    Your Goal: Analyze a Source User's profile against a Candidate User's profile to identify A SINGLE HIGH-VALUE opportunity.

    Input:
    - Source Context: The Source User's own Profile.
    - Candidate Profile (JSON)
    - Existing Opportunities (Context of matches already made)

    Output:
    - A list containing EXACTLY ONE "Opportunity" if a match exists.
    - If NO match exists, return an empty list.
    - Score (0-100): How strong is this match?
      - 90-100: "Must Meet" (Perfect alignment).
      - 70-89: "Should Meet" (Strong overlaps, clear potential).
      - <70: No opportunity (Return empty list).

    **CRITICAL: VALENCY & REASONING**
    
    1. **Valency Analysis**:
       - Determine the semantic role of the Candidate relative to the Source's goal.
       - "Agent": The Candidate CAN DO something for the Source (e.g., Source needs a dev, Candidate IS a dev).
       - "Patient": The Candidate NEEDS something from the Source (e.g., Source is a mentor, Candidate needs mentoring).
       - "Peer": Symmetric collaboration.

    2. **Reasoning (Third-Party Analytical Perspective)**:
       - **reasoning**: A neutral, third-party explanation of why this opportunity exists. Written for other LLM agents to read and understand.
       - Mention BOTH users by their roles (e.g. "The source user" and "The candidate") and explain why they are a match.
       - Do NOT address either user as "you". Write from an objective observer's perspective.
       - Include what each side brings to the connection and why it is mutually valuable.
       - NEVER leak private intents. If someone's intent is confidential, describe their relevant attributes instead.

    **VISIBILITY IMPLICATIONS OF ROLE ASSIGNMENT**

    The valency role you assign directly controls who sees the opportunity and when:
    - "Agent" (helper/provider): LAST to see the opportunity — only after the Patient has committed to reaching out. Agents are protected from noise; they only see high-intent connections.
    - "Patient" (seeker/requester): Sees the opportunity early and decides whether to reach out.
    - "Peer" (symmetric): Both parties see the opportunity immediately and either can initiate.

    Choose the role carefully — it determines the entire flow of how the connection unfolds.

    Rules:
    1. SYNTHESIS (CRITICAL): If multiple distinct match angles exist, SYNTHESIZE them into a SINGLE, robust opportunity.
    2. NEVER address either user directly — always use third-party references ("the source", "the candidate").
    3. COMPREHENSIVE: The single opportunity must capture ALL the value of the connection.
    4. Be specific about the "Why" for BOTH sides in the reasoning.
    5. DEDUPLICATION: Do NOT suggest opportunities that duplicate "Existing Opportunities".
`;

// Entity-bundle system prompt (C2): entities + four match patterns + actors output
const entityBundleSystemPrompt = `
You are an expert "Opportunity Matcher" and super-connector.
Your Goal: Analyze a set of entities (people), each with a profile and optional intents, and identify HIGH-VALUE opportunities among them.

Input:
- DISCOVERER: The user ID who triggered discovery (for context; they may or may not be in the entity list).
- ENTITIES: A set of entities. Each entity has:
  - userId, indexId (the index through which they were found)
  - profile: name, bio, location, interests, skills, context
  - intents (optional): list of { intentId, payload, summary } — some entities are profile-only, some have intents
  - ragScore, matchedVia (how they were found)
- EXISTING OPPORTUNITIES: Context of matches already made (for deduplication).

Match patterns to consider:
1. Profile-to-profile: Complementary backgrounds (skills, interests, location).
2. Profile-to-intents+profile: Someone's skills/background match another's stated goals (intents).
3. Intents+profile-to-profile: Someone's stated goals match another's skills/background.
4. Intents+profile-to-intents+profile: Complementary or reciprocal goals between two or more people.

Output:
- A list of 0..N opportunities. Each opportunity has:
  - reasoning: Third-party analytical explanation (for other LLM agents). Mention entities by role. Do NOT use "you". Never leak private intents.
  - score: 0-100. 90-100 = Must Meet, 70-89 = Should Meet, <70 = do not include.
  - actors: At least 2 actors per opportunity. Each actor has:
    - userId
    - role: "agent" (can do something for others), "patient" (needs something from others), "peer" (symmetric collaboration)
    - intentId (optional): if the match is intent-driven, the specific intent ID for that user

VISIBILITY (role controls who sees the opportunity when):
- agent: Last to see — after the patient has committed to reaching out.
- patient: Sees early and decides whether to reach out.
- peer: Both see immediately; either can initiate.

Rules:
1. SYNTHESIS: If multiple match angles exist among the same set of people, synthesize into one opportunity.
2. You may propose 2 or more actors per opportunity (e.g. three people who should collaborate).
3. DEDUPLICATION: Do not suggest opportunities that duplicate Existing Opportunities.
4. Write reasoning from an objective observer's perspective; be specific about the "Why" for each side.
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

const OpportunitySchema = z.object({
  reasoning: z.string().describe('Third-party analytical explanation of why this opportunity exists. Mentions both users by role. Written for other LLM agents to understand the match.'),
  score: z.number().min(0).max(100).describe('Relevance score 0-100'),
  valencyRole: z.enum(['Agent', 'Patient', 'Peer']).describe("The semantic role of the Candidate relative to the Source"),
  sourceId: z.string().describe('The user ID of the source'),
  candidateId: z.string().describe('The user ID of the candidate'),
});

const responseFormat = z.object({
  opportunities: z.array(OpportunitySchema).describe("List of opportunities identified"),
});

// ─── Entity-bundle evaluator (C1): types and output schema with actors ───

export interface EvaluatorEntity {
  userId: string;
  profile: {
    name?: string;
    bio?: string;
    location?: string;
    interests?: string[];
    skills?: string[];
    context?: string;
  };
  intents?: Array<{
    intentId: string;
    payload: string;
    summary?: string;
  }>;
  indexId: string;
  ragScore?: number;
  matchedVia?: string;
}

export interface EvaluatorInput {
  /** The user who triggered discovery (for context, not special treatment). */
  discovererId: string;
  /** All relevant entities from RAG results + the discoverer themselves. */
  entities: EvaluatorEntity[];
  /** Existing opportunities for deduplication. */
  existingOpportunities?: string;
}

const ActorSchema = z.object({
  userId: z.string(),
  role: z.enum(['agent', 'patient', 'peer']),
  intentId: z.string().nullable().describe('If the match is intent-driven, the specific intent ID; null otherwise'),
});

const OpportunityWithActorsSchema = z.object({
  reasoning: z.string(),
  score: z.number().min(0).max(100),
  actors: z.array(ActorSchema).min(2).describe('All actors in this opportunity with their roles'),
});

const entityBundleResponseFormat = z.object({
  opportunities: z.array(OpportunityWithActorsSchema).describe('List of opportunities (0..N)'),
});

export type EvaluatorActor = z.infer<typeof ActorSchema>;
export type EvaluatedOpportunityWithActors = z.infer<typeof OpportunityWithActorsSchema>;
export type EvaluatorOutputBundle = z.infer<typeof entityBundleResponseFormat>;

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

export type Opportunity = z.infer<typeof OpportunitySchema>;
export type EvaluatorOutput = z.infer<typeof responseFormat>;

// Define CandidateProfile type (simplified for now, ideally imported from shared types)
export interface CandidateProfile {
  userId: string;
  identity?: { name?: string; bio?: string; location?: string };
  attributes?: { interests?: string[]; skills?: string[] };
  narrative?: { context?: string };
  score?: number; // Search score
}

export interface OpportunityEvaluatorOptions {
  minScore?: number;
  limit?: number;
  hydeDescription?: string;
  /** When set (e.g. from chat discovery), HyDE runs only these strategies instead of inferring from intent. */
  strategies?: HydeStrategy[];
  existingOpportunities?: string;
  candidates?: CandidateProfile[]; // For direct evaluation
  filter?: Record<string, unknown>;
  initialStatus?: OpportunityStatus;
}

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

export class OpportunityEvaluator {
  private model: Runnable;
  private entityBundleModel: Runnable;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "opportunity_evaluator"
    });
    this.entityBundleModel = model.withStructuredOutput(entityBundleResponseFormat, {
      name: "opportunity_evaluator_entity_bundle"
    });
  }

  /**
   * Main Entry Point: Batch analysis of candidates.
   * 
   * @param sourceProfileContext - The profile context string of the user we are finding opportunities FOR.
   * @param candidates - List of potential matches to evaluate.
   * @param options - Config (minScore, valid types, etc).
   * @returns A sorted list of high-value `Opportunity` objects.
   */
  public async invoke(
    sourceProfileContext: string,
    candidates: CandidateProfile[],
    options: OpportunityEvaluatorOptions
  ): Promise<Opportunity[]> {
    const minScore = options.minScore || 70;

    logger.info(`[OpportunityEvaluator.invoke] Analyzing ${candidates.length} candidates...`);

    if (candidates.length === 0) {
      logger.info('[OpportunityEvaluator] No candidates provided.');
      return [];
    }

    const opportunities: Opportunity[] = [];

    // Analyze each candidate in parallel (bounded)
    const promises = candidates.map(async (candidate) => {
      // Pass existing opportunities context if provided
      const existingContext = options.existingOpportunities || '';
      return this.analyzeMatch(sourceProfileContext, candidate, candidate.userId, existingContext);
    });

    const results = await Promise.all(promises);
    results.flat().forEach(op => {
      if (op.score >= minScore) {
        opportunities.push(op as Opportunity);
      }
    });

    // Sort by score and take top 1
    const out = opportunities.sort((a, b) => b.score - a.score).slice(0, 1);
    logger.info('[OpportunityEvaluator.invoke] Done', { accepted: out.length });
    return out;
  }

  /**
   * Analyze a single match pair using the primary Agent model.
   */
  private async analyzeMatch(
    sourceProfileContext: string,
    candidateProfile: CandidateProfile,
    candidateUserId: string,
    existingOpportunities: string
  ): Promise<Opportunity[]> {
    try {
      // Construct the source context part of the prompt
      const sourceContext = `SOURCE PROFILE:\n${sourceProfileContext}`;

      const existingContextPart = existingOpportunities
        ? `\nEXISTING OPPORTUNITIES (Deduplication Context):\n${existingOpportunities}\n`
        : '';

      // Create candidate context using template string
      const candidateContext = `
            ID: ${candidateUserId}
            Name: ${candidateProfile.identity?.name || 'Unknown'}
            Bio: ${candidateProfile.identity?.bio || ''}
            Location: ${candidateProfile.identity?.location || ''}
            Interests: ${candidateProfile.attributes?.interests?.join(', ') || ''}
            Skills: ${candidateProfile.attributes?.skills?.join(', ') || ''}

            Context: ${candidateProfile.narrative?.context || ''}
            `;

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(`${sourceContext}\n${existingContextPart}\nCANDIDATE PROFILE:\n${candidateContext}`)
      ];

      const result = await this.model.invoke(messages);
      const output = responseFormat.parse(result);

      const mappedOpportunities = output.opportunities.map((op: Opportunity) => ({
        ...op,
        candidateId: candidateUserId,
      }));

      return mappedOpportunities;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.info(`[OpportunityEvaluator] Analysis failed for candidate ${candidateUserId}`, { message });
      return [];
    }
  }

  /**
   * Entity-bundle entry point (C3): single LLM call with all entities, returns 0..N opportunities with actors.
   */
  public async invokeEntityBundle(
    input: EvaluatorInput,
    options: { minScore?: number } = {}
  ): Promise<EvaluatedOpportunityWithActors[]> {
    const minScore = options.minScore ?? 70;
    const totalEntities = input.entities?.length ?? 0;
    if (!input.entities?.length) {
      logger.info('[OpportunityEvaluator.invokeEntityBundle] No entities.');
      return [];
    }
    const existingPart = input.existingOpportunities
      ? `\nEXISTING OPPORTUNITIES:\n${input.existingOpportunities}\n`
      : '';
    const entitiesBlock = input.entities.map((e) => {
      const intentsPart = e.intents?.length
        ? `\n  INTENTS:\n${e.intents.map((i) => `    - ${i.intentId}: ${i.payload}`).join('\n')}`
        : '';
      return `
  USER: ${e.userId}
  INDEX: ${e.indexId}
  PROFILE: Name: ${e.profile.name ?? ''} | Bio: ${e.profile.bio ?? ''} | Location: ${e.profile.location ?? ''} | Interests: ${e.profile.interests?.join(', ') ?? ''} | Skills: ${e.profile.skills?.join(', ') ?? ''} | Context: ${e.profile.context ?? ''}${intentsPart}
  RAG SCORE: ${e.ragScore ?? '—'}
  MATCHED VIA: ${e.matchedVia ?? '—'}`;
    }).join('\n');
    const humanContent = `DISCOVERER: ${input.discovererId}\n\nENTITIES:\n${entitiesBlock}${existingPart}`;
    const messages = [
      new SystemMessage(entityBundleSystemPrompt),
      new HumanMessage(humanContent),
    ];
    let parsedTotal = 0;
    try {
      const result = await this.entityBundleModel.invoke(messages);
      const parsed = entityBundleResponseFormat.parse(result);
      parsedTotal = parsed.opportunities.length;
      const filtered = parsed.opportunities.filter((op) => op.score >= minScore);
      logger.info('[OpportunityEvaluator.invokeEntityBundle] Done', { total: parsed.opportunities.length, accepted: filtered.length });
      return filtered;
    } catch (llmError) {
      logger.error('[OpportunityEvaluator.invokeEntityBundle] Failed; returning empty opportunities.', {
        discovererId: input.discovererId,
        totalEntities,
        parsedTotal,
        minScore,
        llmError,
      });
      return [];
    }
  }

  /**
   * Factory method to expose the agent as a LangChain tool.
   * Simplified to only accept direct evaluation arguments.
   * PURE: Does not perform any database lookups.
   */
  public static asTool() {
    return tool(
      async (args: {
        sourceProfileContext: string;
        candidatesJson?: string;
        minScore?: number;
      }) => {
        const agent = new OpportunityEvaluator();

        const sourceProfileContext = args.sourceProfileContext;

        let candidates: CandidateProfile[] = [];
        if (args.candidatesJson) {
          try {
            candidates = JSON.parse(args.candidatesJson);
          } catch (e) {
            logger.error("Failed to parse candidates JSON");
          }
        }

        const options: OpportunityEvaluatorOptions = {
          minScore: args.minScore,
        };

        return await agent.invoke(sourceProfileContext, candidates, options);
      },
      {
        name: 'opportunity_evaluator',
        description: 'Evaluates candidates against a source profile. SOURCE PROFILE CONTEXT MUST BE PROVIDED.',
        schema: z.object({
          sourceProfileContext: z.string().describe('The resolved source user profile context'),
          candidatesJson: z.string().optional().describe('JSON string list of Candidates'),
          minScore: z.number().optional().describe('Minimum score to accept a match')
        })
      }
    );
  }
}
