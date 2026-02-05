import { z } from 'zod';
import { BaseLangChainAgent } from '../../lib/langchain/langchain';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { ProfileGeneratorOutput } from './profile.generator.types';
import { log } from '../../lib/log';
import { Embedder } from '../common/types';

const logger = log.agent.from("agents/profile/profile.generator.ts");

export const SYSTEM_PROMPT = `
    You are an expert profiler. Your task is to synthesize a structured User Profile from raw data scraped from the web (via Parallel.ai).

    Output Rules:
    1. Infer their name from the data.
    2. Synthesize a coherent 'bio'.
    3. Infer their current 'location' (City, Country formatted).
    4. Write a rich 'narrative.context' describing their current situation, constraints, and background in detail.
    5. Extract specific 'skills' and 'interests'.
`;

// Zod Schemas for local validation/structured output definition
export const UserProfileSchema = z.object({
    identity: z.object({
        name: z.string().describe("The user's full name"),
        bio: z.string().describe("A professional summary (2-3 sentences)"),
        location: z.string().describe("Inferred location (City, Country) or 'Remote'"),
    }),
    narrative: z.object({
        context: z.string().describe("A rich, detailed narrative about the user's current situation, background, and what they are currently working on. Use raw, natural language."),
    }),
    attributes: z.object({
        interests: z.array(z.string()).describe("Inferred or explicit interests"),
        skills: z.array(z.string()).describe("Professional skills"),
    }),
});

export const ProfileGeneratorOutputSchema = z.object({
    profile: UserProfileSchema,
});

/**
 * ProfileGenerator Agent
 * 
 * Synthesizes a structured "User Memory Profile" from raw unstructured data.
 * 
 * DATASOURCE:
 * - Primarily designed to ingest raw JSON from `Parallel.ai` (LinkedIn/Web scraping results).
 * 
 * RESPONSIBILITY:
 * - Entity Extraction: Name, Location, Role.
 * - Narrative Synthesis: Writes the "Story" of the user (Bio, Context, Aspirations) based on scattered data points.
 * - Structuring: Converts loose text into strictly typed JSON (Zod schema).
 * 
* This is the entry point for creating a "Digital Twin" of a user in the system.
 */
export class ProfileGenerator extends BaseLangChainAgent {
    private embedder?: Embedder;

    constructor(embedder?: Embedder) {
        super({
            preset: 'profile-generator', // Use a strong model for synthesis
            responseFormat: ProfileGeneratorOutputSchema
        });
        this.embedder = embedder;
    }

    /**
     * Run the profile generation.
     * 
     * @param input - The raw text or stringified JSON from the data source (e.g., Parallel.ai).
     * @returns Promise resolving to a fully structured `ProfileGeneratorOutput` object (Identity, Narrative, Attributes).
     */
    async run(input: string): Promise<ProfileGeneratorOutput & { embedding?: number[] }> {
        logger.debug('[ProfileGenerator] Processing input', { inputLength: input.length });

        const messages = [
            new SystemMessage(SYSTEM_PROMPT),
            new HumanMessage(`Here is the raw data:\n${input}`)
        ];

        const result = await this.model.invoke(messages);
        const output = result.structuredResponse as ProfileGeneratorOutput;
        logger.info(`[ProfileGenerator] Successfully generated profile for "${output.profile.identity.name}".`);

        let embedding: number[] | undefined;
        if (this.embedder) {
            logger.info(`[ProfileGenerator] Generating embedding for profile...`);
            // Construct text to embed: Bio + Context + Aspirations + Skills + Interests
            const p = output.profile;
            const parts = [
                p.identity.bio,
                p.identity.location,
                p.narrative.context,
                ...p.attributes.interests,
                ...p.attributes.skills
            ];
            const textToEmbed = parts.filter(Boolean).join(' ');

            if (textToEmbed.length > 0) {
                const embedResult = await this.embedder.generate(textToEmbed);
                embedding = Array.isArray(embedResult[0]) ? (embedResult as number[][])[0] : (embedResult as number[]);
            }
        }

        return { ...output, embedding };
    }
}
