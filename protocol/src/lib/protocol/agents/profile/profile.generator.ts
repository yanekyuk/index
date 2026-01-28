import { ChatOpenAI } from "@langchain/openai";
import { createAgent, HumanMessage, ReactAgent, tool } from "langchain";
import { z } from "zod/v4";
import { log } from "../../../log";
/**
 * Config
 */
import { config } from "dotenv";
config({ path: '.env.development', override: true });

const model = new ChatOpenAI({ model: 'google/gemini-3-flash-preview', configuration: { baseURL: process.env.OPENROUTER_BASE_URL, apiKey: process.env.OPENROUTER_API_KEY } });

const systemPrompt = `
    You are an expert profiler. Your task is to synthesize a structured User Profile from raw data scraped from the web (via Parallel.ai).

    Output Rules:
    1. Infer their name from the data.
    2. Synthesize a coherent 'bio'.
    3. Infer their current 'location' (City, Country formatted).
    4. Write a rich 'narrative.context' describing their current situation, constraints, and background in detail.
    5. Extract specific 'skills' and 'interests'.
`;

const responseFormat = z.object({
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

type Profile = z.infer<typeof responseFormat>;
export type ProfileDocument = Profile & { userId: string, embedding: number[] | number[][] };

export class ProfileGenerator {
  private agent: ReactAgent;
  constructor() {
    this.agent = createAgent({ model, responseFormat, systemPrompt });
  }

  private toString(profile: Profile): string {
    const textToEmbed = [
      '# Identity',
      '## Name', profile.identity.name,
      '## Bio', profile.identity.bio,
      '## Location', profile.identity.location,
      '# Narrative',
      '## Context', profile.narrative.context,
      '# Attributes',
      '## Interests', profile.attributes.interests.join(', '),
      '## Skills', profile.attributes.skills.join(', ')
    ].join('\n');

    return textToEmbed;
  }

  public async invoke(input: string) {
    log.info('[ProfileGenerator.invoke] Received input', { input });
    const messages = [new HumanMessage(`Here is the raw data:\n${input}`)];
    const result = await this.agent.invoke({ messages });
    const output = responseFormat.parse(result.structuredResponse);
    const textToEmbed = this.toString(output);
    log.info(`[ProfileGenerator.invoke] Successfully generated profile`, { output, textToEmbed });
    return { output, textToEmbed };
  }

  public static asTool() {
    return tool(
      async (args: { input: string }) => {
        const profileGenerator = new ProfileGenerator();
        return await profileGenerator.invoke(args.input);
      },
      {
        name: 'profileGenerator',
        description: 'Profile Generator',
        schema: z.object({
          input: z.string().describe('Raw data scraped from the web (via Parallel.ai)'),
        })
      }
    );
  }
}