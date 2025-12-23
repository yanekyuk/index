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
import { json2md } from '../../lib/json2md/json2md';

// ----------------

// System prompt for the Opportunity Evaluator Agent (Analysis Stage)
const ANALYSIS_SYSTEM_PROMPT = `
    You are an expert "Opportunity Matcher" and super-connector.
    Your Goal: Analyze a Source User's "Ideal Match Description" (or their Profile) against a Candidate User's profile to identify HIGH-VALUE opportunities.

    Input:
    - Source Context: Either an "Ideal Partner Description" (HyDE) OR the User's own Profile.
    - Candidate Profile (JSON)

    Output:
    - A list of distinct "Opportunities" (if any).
    - Score (0-100): How strong is this match?
    - 90-100: "Must Meet" (Perfect alignment with the Ideal Description).
    - 70-89: "Should Meet" (Strong overlaps, clear potential).
    - <70: No opportunity (Return empty list).

    Rules:
    1. IMPERATIVE: Address the SOURCE User as "You". NEVER use their name. Refer to the CANDIDATE by their name.
    2. COMPREHENSIVE: If multiple distinct matches exist, you MUST mention ALL of them. Do not focus on just one.
    3. SYNTHESIS: Combine these points into a single cohesive narrative paragraph.
    4. Be specific about the "Why".
`;

// --- SCHEMAS ---
const OpportunitySchema = z.object({
    type: z.enum(['collaboration', 'mentorship', 'networking', 'other']),
    title: z.string().describe('Short title of the opportunity'),
    description: z.string().describe('Reasoning why this is a good match'),
    score: z.number().min(0).max(100).describe('Relevance score 0-100'),
    candidateId: z.string().describe('The user ID of the match'),
});

const OpportunityEvaluatorOutputSchema = z.object({
    opportunities: z.array(OpportunitySchema),
});

/**
 * OpportunityEvaluator Agent
 * 
 * The "Super Connector" agent responsible for finding high-value connections between users.
 * 
 * LOGIC:
 * 1. Takes a Source User (the person looking for something).
 * 2. Takes a list of Candidate Users (retrieved via vector search, usually using HyDE).
 * 3. Analyzes the FIT between Source and Candidate.
 * 4. Generates specific "Opportunities" (Collaboration, Mentorship, etc.) with a Score (0-100).
 * 
 * DIFFERENTIATION:
 * Unlike `StakeEvaluator` (which checks if two specific intents match), this agent looks at the
 * WHOLE PROFILE vs WHOLE PROFILE to find broader, implicit opportunities.
 */
export class OpportunityEvaluator extends BaseLangChainAgent {

    constructor() {
        // Main model is for Analysis (structured output of Opportunities)
        super({
            model: 'openai/gpt-4o',
            temperature: 0.1, // Low temp for stability
            responseFormat: OpportunityEvaluatorOutputSchema
        });
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
     * @param sourceProfile - The profile of the user we are finding opportunities FOR.
     * @param candidates - List of potential matches to evaluate.
     * @param options - Config (minScore, valid types, etc).
     * @returns A sorted list of high-value `Opportunity` objects.
     */
    async evaluateOpportunities(
        sourceProfile: UserMemoryProfile,
        candidates: CandidateProfile[],
        options: OpportunityEvaluatorOptions = {}
    ): Promise<Opportunity[]> {
        const minScore = options.minScore || 70;
        const hydeDescription = options.hydeDescription; // NEW: Accept HyDE description

        log.info(`[OpportunityEvaluator] Analyzing ${candidates.length} candidates for opportunities...`);

        if (candidates.length === 0) {
            log.info('[OpportunityEvaluator] No candidates provided.');
            return [];
        }

        const opportunities: Opportunity[] = [];

        // Analyze each candidate in parallel (bounded)
        const promises = candidates.map(async (candidate) => {
            return this.analyzeMatch(sourceProfile, candidate, candidate.userId, hydeDescription);
        });

        const results = await Promise.all(promises);
        results.flat().forEach(op => {
            if (op.score >= minScore) {
                opportunities.push(op as Opportunity);
            }
        });

        // Sort by score
        return opportunities.sort((a, b) => b.score - a.score);
    }

    /**
     * Helper to generate a direct search query text.
     */
    generateDirectQuery(sourceProfile: UserMemoryProfile): string {
        return json2md.fromObject({
            Bio: sourceProfile.identity.bio,
            Interests: sourceProfile.attributes?.interests,
            Skills: sourceProfile.attributes?.skills,
            Aspirations: sourceProfile.narrative?.aspirations
        });
    }

    /**
     * Analyze a single match pair using the primary Agent model
     */
    private async analyzeMatch(
        sourceProfile: UserMemoryProfile,
        candidateProfile: CandidateProfile,
        candidateUserId: string,
        hydeDescription?: string
    ): Promise<Opportunity[]> {
        try {
            // Construct the source context part of the prompt
            let sourceContext = "";
            if (hydeDescription) {
                sourceContext = `SOURCE'S IDEAL MATCH DESCRIPTION:\n${hydeDescription}`;
            } else {
                sourceContext = `SOURCE PROFILE:\n${json2md.fromObject(sourceProfile as any)}`;
            }

            const messages = [
                new SystemMessage(ANALYSIS_SYSTEM_PROMPT),
                new HumanMessage(`${sourceContext}\n\nCANDIDATE PROFILE:\n${json2md.fromObject(candidateProfile as any)}`)
            ];

            // Primary model is already configured with OutputSchema
            const result = await this.model.invoke(messages) as any;

            // Handle potential variations in structured output return
            let opportunitiesList = [];
            if (result.opportunities) {
                opportunitiesList = result.opportunities;
            } else if (result.structuredResponse?.opportunities) {
                opportunitiesList = result.structuredResponse.opportunities;
            } else if (typeof result === 'object' && Array.isArray(result.opportunities)) {
                opportunitiesList = result.opportunities;
            }

            return opportunitiesList.map((op: Opportunity) => ({
                ...op,
                candidateId: candidateUserId
            }));
        } catch (e) {
            log.info(`[OpportunityEvaluator] Analysis failed for candidate ${candidateUserId}`, { error: e });
            return [];
        }
    }
}
