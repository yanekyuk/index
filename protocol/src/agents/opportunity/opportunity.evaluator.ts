import { BaseLangChainAgent } from '../../lib/langchain/langchain';
import { log } from '../../lib/log';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { UserMemoryProfile } from '../intent/manager/intent.manager.types';
import {
  Opportunity,
  OpportunityEvaluatorOptions,
  CandidateProfile
} from './opportunity.evaluator.types';
import { z } from 'zod';
import { Embedder } from '../common/types';

const logger = log.agent.from("agents/opportunity/opportunity.evaluator.ts");

// ----------------

// System prompt for the Opportunity Evaluator Agent (Analysis Stage)
const ANALYSIS_SYSTEM_PROMPT = `
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


// --- SCHEMAS ---
const OpportunitySchema = z.object({
  sourceDescription: z.string().describe('Source-facing: Why the SOURCE user should meet the candidate. Address them as "You".'),
  candidateDescription: z.string().describe('Candidate-facing: Why the CANDIDATE should meet the source. Address them as "You".'),
  score: z.number().min(0).max(100).describe('Relevance score 0-100'),
  sourceId: z.string().describe('The user ID of the source'),
  candidateId: z.string().describe('The user ID of the candidate'),
});

const OpportunityEvaluatorOutputSchema = z.object({
  opportunities: z.array(OpportunitySchema),
});

type EvaluatorOutput = z.infer<typeof OpportunityEvaluatorOutputSchema>;

/**
 * OpportunityEvaluator Agent
 * 
 * The "Super Connector" agent responsible for finding high-value connections between users.
 * 
 * LOGIC:
 * 1. Takes a Source User (the person looking for something).
 * 2. Takes a list of Candidate Users (retrieved via vector search, usually using HyDE).
 * 3. Analyzes the FIT between Source and Candidate.
 * 4. Generates a SINGLE "Opportunity" (Synthesized) with a Score (0-100).
 * 
 * DIFFERENTIATION:
 * Unlike `StakeEvaluator` (which checks if two specific intents match), this agent looks at the
 * WHOLE PROFILE vs WHOLE PROFILE to find broader, implicit opportunities.
 */
export class OpportunityEvaluator extends BaseLangChainAgent {
  private embedder?: Embedder;

  constructor(embedder?: Embedder) {
    // Main model is for Analysis (structured output of Opportunities)
    super({
      preset: 'opportunity-evaluator',
      temperature: 0.1, // Low temp for stability
      responseFormat: OpportunityEvaluatorOutputSchema
    });
    this.embedder = embedder;
  }

  /**
   * Main Entry Point: Batch analysis of candidates.
   * 
   * PROCESS:
   * 1. Iterates through the provided list of candidates.
   * 2. Calls the LLM to analyze the match against the Source Profile (or HyDE description).
   * 3. Aggregates results, filters by `minScore` (default 70).
   * 4. Returns a sorted list of the best Opportunities.
   * 
   * @param sourceProfileContext - The profile context string of the user we are finding opportunities FOR.
   * @param candidates - List of potential matches to evaluate.
   * @param options - Config (minScore, valid types, etc).
   * @returns A sorted list of high-value `Opportunity` objects.
   */
  async evaluateOpportunities(
    sourceProfileContext: string,
    candidates: CandidateProfile[],
    options: OpportunityEvaluatorOptions
  ): Promise<Opportunity[]> {
    const minScore = options.minScore || 70;
    // hydeDescription is NOT used here anymore.

    logger.info(`[OpportunityEvaluator] Analyzing ${candidates.length} candidates for opportunities...`);

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
    return opportunities.sort((a, b) => b.score - a.score).slice(0, 1);
  }

  /**
   * Discovery Mode: Autonomous Retrieval + Analysis
   * 
   * 1. Generates search query (embedding source profile or HyDE).
   * 2. Retrieves candidates using injected Embedder.
   * 3. Evaluates found candidates.
   */
  async runDiscovery(
    sourceProfileContext: string,
    options: OpportunityEvaluatorOptions & { limit?: number, candidates?: CandidateProfile[], filter?: Record<string, unknown> } // candidates optional for MemorySearcher
  ): Promise<Opportunity[]> {
    logger.info('[OpportunityEvaluator] Starting Discovery run...');

    const foundCandidates = await this.findCandidates(options);
    logger.info(`[OpportunityEvaluator] Found ${foundCandidates.length} potential candidates from search.`);

    // 3. Evaluate Matches
    return this.evaluateOpportunities(sourceProfileContext, foundCandidates, options);
  }

  /**
   * Find candidates using the injected embedder (HyDE -> Embedding -> Search).
   */
  async findCandidates(
    options: OpportunityEvaluatorOptions & { limit?: number, candidates?: CandidateProfile[], filter?: Record<string, unknown> }
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
      'profiles',
      {
        ...options, // Propagate minScore, filters, etc.
        limit: options.limit || 5,
        // For MemorySearcher, we might pass candidates directly in options to search against
        candidates: options.candidates
      }
    );

    return searchResults.map(r => r.item);
  }


  /**
   * Helper to generate a direct search query text.
   */
  generateDirectQuery(sourceProfile: UserMemoryProfile): string {
    return `
        Bio: ${sourceProfile.identity.bio}
        Interests: ${sourceProfile.attributes?.interests?.join(', ')}
        Skills: ${sourceProfile.attributes?.skills?.join(', ')}

        `;
  }

  /**
   * Analyze a single match pair using the primary Agent model.
   * 
   * IMPORTANT: This method now strictly uses the Source Profile for evaluation.
   * The HyDE description is used ONLY for the search/discovery phase (upstream).
   * 
   * @param sourceProfileContext - The profile context of the source user.
   * @param candidateProfile - The profile of the candidate being evaluated.
   * @param candidateUserId - The ID of the candidate user.
   * @returns A promise resolving to a list of identified opportunities.
   */
  private async analyzeMatch(
    sourceProfileContext: string,
    candidateProfile: CandidateProfile,
    candidateUserId: string,
    existingOpportunities: string
  ): Promise<Opportunity[]> {
    try {
      // Construct the source context part of the prompt
      //STRICT: Use Source Profile
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
        new SystemMessage(ANALYSIS_SYSTEM_PROMPT),
        new HumanMessage(`${sourceContext}\n${existingContextPart}\nCANDIDATE PROFILE:\n${candidateContext}`)
      ];

      // Primary model is already configured with OutputSchema
      const result = await this.model.invoke(messages) as EvaluatorOutput | { structuredResponse: EvaluatorOutput };

      // Handle potential variations in structured output return
      let opportunitiesList: Opportunity[] = [];

      if ('opportunities' in result && Array.isArray(result.opportunities)) {
        opportunitiesList = result.opportunities;
      } else if ('structuredResponse' in result && result.structuredResponse?.opportunities) {
        opportunitiesList = result.structuredResponse.opportunities;
      }

      const mappedOpportunities = opportunitiesList.map((op: any) => ({
        ...op,
        candidateId: candidateUserId,
        // Ensure candidateDescription exists (fallback for backward compat)
        candidateDescription: op.candidateDescription || op.description
      }));

      return mappedOpportunities;
    } catch (e) {
      logger.info(`[OpportunityEvaluator] Analysis failed for candidate ${candidateUserId}`, { error: e });
      return [];
    }
  }
}
