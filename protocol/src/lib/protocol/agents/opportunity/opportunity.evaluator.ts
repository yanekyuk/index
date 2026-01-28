import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Runnable } from "@langchain/core/runnables";
import { z } from "zod";
import { log } from "../../../log";
import { Database } from "../../interfaces/database.interface";
import { Embedder } from "../../interfaces/embedder.interface";


/**
 * Config
 */
import { config } from "dotenv";
config({ path: '.env.development', override: true });

// 
const model = new ChatOpenAI({
  model: 'google/gemini-3-flash-preview',
  configuration: { baseURL: process.env.OPENROUTER_BASE_URL, apiKey: process.env.OPENROUTER_API_KEY }
})

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

    **CRITICAL: TWO DESCRIPTIONS REQUIRED**
    Each opportunity MUST contain TWO separate descriptions:
    1. **description** (Source-facing): Written for the SOURCE user. Address them as "You". Explain why THEY should meet the Candidate.
    2. **candidateDescription** (Candidate-facing): Written for the CANDIDATE. Address THEM as "You". Explain why THEY should meet the Source.

    Example:
    - description: "You should meet Alice because she has expertise in AI that aligns with your goal to build intelligent systems."
    - candidateDescription: "You should meet Bob because he is building a product that could benefit from your AI expertise."

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
  existingOpportunities?: string;
  candidates?: CandidateProfile[]; // For direct evaluation
  filter?: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

export class OpportunityEvaluator {
  private agent: Runnable;
  private database: Database;
  private embedder: Embedder;

  constructor(database: Database, embedder: Embedder) {
    this.agent = model;
    this.database = database;
    this.embedder = embedder;
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

    log.info(`[OpportunityEvaluator.invoke] Analyzing ${candidates.length} candidates...`);

    if (candidates.length === 0) {
      log.info('[OpportunityEvaluator] No candidates provided.');
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
    return opportunities.sort((a, b) => b.score - a.score).slice(0, 1);
  }

  /**
   * Discovery Mode: Autonomous Retrieval + Analysis
   * 
   * 1. Generates search query (embedding source profile or HyDE).
   * 2. Retrieves candidates using injected Embedder.
   * 3. Evaluates found candidates.
   */
  public async runDiscovery(
    sourceProfileContext: string,
    options: OpportunityEvaluatorOptions
  ): Promise<Opportunity[]> {
    log.info('[OpportunityEvaluator] Starting Discovery run...');

    const foundCandidates = await this.findCandidates(options);
    log.info(`[OpportunityEvaluator] Found ${foundCandidates.length} potential candidates from search.`);

    // 3. Evaluate Matches
    return this.invoke(sourceProfileContext, foundCandidates, options);
  }

  /**
   * Find candidates using the injected embedder (HyDE -> Embedding -> Search).
   */
  private async findCandidates(
    options: OpportunityEvaluatorOptions
  ): Promise<CandidateProfile[]> {
    if (!this.embedder) {
      throw new Error("Embedder must be injected to use findCandidates");
    }

    // 1. Generate Query Vector
    // STRICT: Use HyDE Description for Search
    const queryText = options.hydeDescription;

    if (!queryText) {
      throw new Error("HyDE Description is required for Search.");
    }

    const embeddingResult = await this.embedder.generate(queryText);
    // Handle return type (array of vector or single vector)
    const queryVector = Array.isArray(embeddingResult[0])
      ? (embeddingResult as number[][])[0]
      : (embeddingResult as number[]);

    // 2. Search for Candidates
    const searchResults = await this.embedder.search<CandidateProfile>(
      queryVector,
      'profiles', // Assuming 'profiles' collection
      {
        filter: options.filter,
        limit: options.limit || 5,
      }
    );

    return searchResults.map(r => r.item);
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

      const result = await this.agent.invoke({ messages });
      const output = responseFormat.parse(result.structuredResponse);

      const mappedOpportunities = output.opportunities.map((op: any) => ({
        ...op,
        candidateId: candidateUserId,
        // Ensure candidateDescription exists (fallback provided by Zod schema but good to be safe)
        candidateDescription: op.candidateDescription
      }));

      return mappedOpportunities;
    } catch (e: any) {
      log.info(`[OpportunityEvaluator] Analysis failed for candidate ${candidateUserId}`, { message: e.message });
      return [];
    }
  }

  /**
   * Factory method to expose the agent as a LangChain tool.
   * 
   * NOTE: This tool wrapper simplifies the input to just accept a source profile and a stringified candidate list, 
   * or a HyDE description for discovery. It's a simplified interface for Graph usage.
   */
  public static asTool(database: Database, embedder: Embedder) {
    return tool(
      async (args: {
        sourceProfileContext?: string;
        sourceUserId?: string;
        candidatesJson?: string;
        hydeDescription?: string;
        minScore?: number;
      }) => {
        const agent = new OpportunityEvaluator(database, embedder);

        // Resolve Source Profile
        let sourceProfileContext = args.sourceProfileContext;
        if (!sourceProfileContext && args.sourceUserId) {
          try {
            // Fetch profile using the generic filter approach as 'userId' is not the primary key 'id'
            // or we could use getById if we knew the profile ID, but we usually have userId.
            // Using get() with filter is safer given the interface we have.
            // We can cast the result to any to access properties since we know the schema shape loosely.
            const profile = await database.get<any>('user_profiles', {
              filter: { userId: args.sourceUserId }
            });

            if (profile) {
              // Format the profile into a context string similar to candidate context
              const identity = profile.identity || {};
              const attributes = profile.attributes || {};
              const narrative = profile.narrative || {};

              sourceProfileContext = `
                Name: ${identity.name || 'Unknown'}
                Bio: ${identity.bio || ''}
                Location: ${identity.location || ''}
                Interests: ${attributes.interests?.join(', ') || ''}
                Skills: ${attributes.skills?.join(', ') || ''}
                Context: ${narrative.context || ''}
              `.trim();
            } else {
              log.warn(`[OpportunityEvaluator] Profile not found for userId: ${args.sourceUserId}`);
            }
          } catch (error) {
            log.error(`[OpportunityEvaluator] Failed to fetch source profile for ${args.sourceUserId}`, { error });
          }
        }

        if (!sourceProfileContext) {
          return "Error: sourceProfileContext or valid sourceUserId is required.";
        }

        let candidates: CandidateProfile[] = [];
        if (args.candidatesJson) {
          try {
            candidates = JSON.parse(args.candidatesJson);
          } catch (e) {
            log.error("Failed to parse candidates JSON");
          }
        }

        const options: OpportunityEvaluatorOptions = {
          minScore: args.minScore,
          hydeDescription: args.hydeDescription
        };

        if (args.hydeDescription && candidates.length === 0) {
          // Run Discovery
          return await agent.runDiscovery(sourceProfileContext, options);
        } else {
          // Run Evaluation
          return await agent.invoke(sourceProfileContext, candidates, options);
        }
      },
      {
        name: 'opportunity_evaluator',
        description: 'Analyzes user profiles to find high-value connection opportunities. Can search for candidates (Discovery) or evaluate provided ones.',
        schema: z.object({
          sourceProfileContext: z.string().optional().describe('The source user profile context'),
          sourceUserId: z.string().optional().describe('The User ID of the source user to fetch profile from DB (if context not provided)'),
          candidatesJson: z.string().optional().describe('JSON string list of CandidateProfile objects to evaluate'),
          hydeDescription: z.string().optional().describe('HyDE description to search for new candidates (Discovery mode)'),
          minScore: z.number().optional().describe('Minimum score to accept a match')
        })
      }
    );
  }
}
