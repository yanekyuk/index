import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { log } from "../../../log";
import type { HydeStrategy } from "../hyde/hyde.strategies";

const logger = log.protocol.from("OpportunityEvaluator");

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

    **CRITICAL: VALENCY & DUAL DESCRIPTIONS**
    
    1. **Valency Analysis**:
       - Determine the semantic role of the Candidate relative to the Source's goal.
       - "Agent": The Candidate CAN DO something for the Source (e.g., Source needs a dev, Candidate IS a dev).
       - "Patient": The Candidate NEEDS something from the Source (e.g., Source is a mentor, Candidate needs mentoring).
       - "Peer": Symmetric collaboration.

    2. **Dual Descriptions (Maxim of Relation)**:
       - **sourceDescription**: Written for the SOURCE. Why is this valuable *to them*? (e.g., "Alice can build your MVP")
       - **candidateDescription**: Written for the CANDIDATE. Why is this valuable *to them*? (e.g., "Bob is hiring for the role you want")
       - NEVER leak intents. Do not say "Bob wants to hire you" if Bob's intent is "Stealth hiring". Say "Bob is working on X".

    Rules:
    1. SYNTHESIS (CRITICAL): If multiple distinct match angles exist, SYNTHESIZE them into a SINGLE, robust opportunity.
    2. NEVER use names when addressing a user directly. Use "You" for the person being addressed.
    3. COMPREHENSIVE: The single opportunity must capture ALL the value of the connection.
    4. Be specific about the "Why" for BOTH sides.
    5. DEDUPLICATION: Do NOT suggest opportunities that duplicate "Existing Opportunities".
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

const OpportunitySchema = z.object({
  sourceDescription: z.string().describe('Source-facing: Why the SOURCE user should meet the candidate. Address them as "You".'),
  candidateDescription: z.string().describe('Candidate-facing: Why the CANDIDATE should meet the source. Address them as "You".'),
  score: z.number().min(0).max(100).describe('Relevance score 0-100'),
  valencyRole: z.enum(['Agent', 'Patient', 'Peer']).describe("The semantic role of the Candidate relative to the Source"),
  sourceId: z.string().describe('The user ID of the source'),
  candidateId: z.string().describe('The user ID of the candidate'),
});

const responseFormat = z.object({
  opportunities: z.array(OpportunitySchema).describe("List of opportunities identified"),
});

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
}

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

export class OpportunityEvaluator {
  private model: any;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "opportunity_evaluator"
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

      const mappedOpportunities = output.opportunities.map((op: any) => ({
        ...op,
        candidateId: candidateUserId,
        // Ensure candidateDescription exists (fallback provided by Zod schema but good to be safe)
        candidateDescription: op.candidateDescription
      }));

      return mappedOpportunities;
    } catch (e: any) {
      logger.info(`[OpportunityEvaluator] Analysis failed for candidate ${candidateUserId}`, { message: e.message });
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
