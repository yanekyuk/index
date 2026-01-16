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

// ----------------

// System prompt for the Opportunity Evaluator Agent (Analysis Stage)
const ANALYSIS_SYSTEM_PROMPT = `
    You are an expert "Opportunity Matcher" and super-connector.
    Your Goal: Analyze a Source User's "Ideal Match Description" (or their Profile) against a Candidate User's profile to identify A SINGLE HIGH-VALUE opportunity.

    Input:
    - Source Context: Either an "Ideal Partner Description" (HyDE) OR the User's own Profile.
    - Candidate Profile (JSON)
    - Existing Opportunities (Context of matches already made)

    Output:
    - A list containing EXACTLY ONE "Opportunity" if a match exists.
    - If NO match exists, return an empty list.
    - Score (0-100): How strong is this match?
    - 90-100: "Must Meet" (Perfect alignment with the Ideal Description).
    - 70-89: "Should Meet" (Strong overlaps, clear potential).
    - <70: No opportunity (Return empty list).

    Rules:
    1. SYNTHESIS (CRITICAL): If multiple distinct match angles exist (e.g., they share interests in AI AND both like Hiking), do NOT list them separately. SYNTHESIZE them into a SINGLE, robust opportunity description.
       - The title should be comprehensive (e.g., "Collaboration on AI & Hiking exploration").
       - The description should weave these points into a cohesive narrative.
    2. IMPERATIVE: Address the SOURCE User as "You". NEVER use their name. Refer to the CANDIDATE by their name.
    3. COMPREHENSIVE: The single opportunity must capture ALL the value of the connection.
    4. Be specific about the "Why".
    5. DEDUPLICATION: You must NOT suggest opportunities that are effectively duplicates of "Existing Opportunities".
       - If the Source has already matched with this Candidate for same reason -> IGNORE.
       - If the Source has seen this exact opportunity -> IGNORE.
       - If the match is new/distinct -> INCLUDE it.
`;


// --- SCHEMAS ---
const OpportunitySchema = z.object({
  type: z.enum(['collaboration', 'mentorship', 'networking', 'other']),
  title: z.string().describe('Short title of the opportunity'),
  description: z.string().describe('Comprehensive reasoning why this is a good match, synthesizing all overlapping areas.'),
  score: z.number().min(0).max(100).describe('Relevance score 0-100'),
  candidateId: z.string().describe('The user ID of the match'),
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
      model: 'openai/gpt-4o',
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

    log.info(`[OpportunityEvaluator] Analyzing ${candidates.length} candidates for opportunities...`);

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
  async runDiscovery(
    sourceProfileContext: string,
    options: OpportunityEvaluatorOptions & { limit?: number, candidates?: CandidateProfile[], filter?: Record<string, unknown> } // candidates optional for MemorySearcher
  ): Promise<Opportunity[]> {
    log.info('[OpportunityEvaluator] Starting Discovery run...');

    const foundCandidates = await this.findCandidates(options);
    log.info(`[OpportunityEvaluator] Found ${foundCandidates.length} potential candidates from search.`);

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

      const mappedOpportunities = opportunitiesList.map((op: Opportunity) => ({
        ...op,
        candidateId: candidateUserId
      }));

      return mappedOpportunities;
    } catch (e) {
      log.info(`[OpportunityEvaluator] Analysis failed for candidate ${candidateUserId}`, { error: e });
      return [];
    }
  }
}
