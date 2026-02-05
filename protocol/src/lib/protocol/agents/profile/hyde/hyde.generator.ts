import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";
import { log } from "../../../../log";
import { ProfileDocument } from "../profile.generator";
/**
 * Config
 */
import { config } from "dotenv";
config({ path: '.env.development', override: true });

const logger = log.protocol.from("HyDEGenerator");

const model = new ChatOpenAI({
  model: 'google/gemini-2.5-flash',
  configuration: { baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY }
});

const systemPrompt = `
    You are a Profile Profiler.
    Given a user's profile, imagine a **Hypothetical User Profile** person that would be the best match for the user to accomplish their goals.
    
    Imagine this ideal candidate actually exists. Write a profile for THEM.
    Your output will be used to vector-search a database of real user profiles.

    Structure your response as a natural language Bio/Narrative written in the **Third Person**.
    
    The description should include:
    1. **Context**: Who they are (role, background).
    2. **Skills/lnterests**: What they are good at that complements the user.
    3. **Goals**: What they are trying to achieve that aligns with the user.
    
    **CRITICAL INSTRUCTION - COMPLEMENTARY MATCHING:**
    - Do NOT just look for "similar" people. Look for people who provide what the user NEEDS (Supply/Demand).
    - If the user is a **Founder**, describe an **Investor** or **VC**.
    - If the user is a **Learner**, describe a **Mentor** or **Expert**.
    - If the user is a **Builder**, describe a **Collaborator** or **Co-founder**.
    
    Do NOT describe the Source User. Describe the TARGET Match.
    Do NOT invent a name for the candidate. Refer to them as "The candidate", "They", or "This individual".
    Do NOT include locations.
`;

const responseFormat = z.object({
  identity: z.object({
    bio: z.string().describe("A professional summary (2-3 sentences)"),
  }),
  narrative: z.object({
    context: z.string().describe("A rich, detailed narrative about the user's current situation, background, and what they are currently working on. Use raw, natural language."),
  }),
  attributes: z.object({
    interests: z.array(z.string()).describe("Inferred or explicit interests"),
    skills: z.array(z.string()).describe("Professional skills"),
  }),
});

type HydeDescription = z.infer<typeof responseFormat>;
type ProfileDocumentWithHyde = ProfileDocument & { hydeDescription: string, hydeEmbedding: number[] | number[][] };

export class HydeGenerator {
  private model: any;
  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "hyde_generator"
    });
  }

  private toString(description: HydeDescription): string {
    const textToEmbed = [
      '# Identity',
      '## Bio', description.identity.bio,
      '# Narrative',
      '## Context', description.narrative.context,
      '# Attributes',
      '## Interests', description.attributes.interests.join(', '),
      '## Skills', description.attributes.skills.join(', ')
    ].join('\n');

    return textToEmbed;
  }

  public async invoke(input: string) {
    logger.info("Received input", { inputLength: input?.length });
    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(`Here is the profile for the HyDE Generation:\n${input}`)
    ];
    const result = await this.model.invoke(messages);
    const output = responseFormat.parse(result);
    const textToEmbed = this.toString(output);
    logger.info("Generated HyDE profile", {
      skillsCount: output.attributes.skills.length,
      interestsCount: output.attributes.interests.length
    });
    return { output, textToEmbed };
  }

  public static asTool() {
    return tool(
      async (args: { input: string }) => {
        const hydeGenerator = new HydeGenerator();
        return await hydeGenerator.invoke(args.input);
      },
      {
        name: 'hydeGenerator',
        description: 'HyDE Generator',
        schema: z.object({
          input: z.string().describe('The profile to generate a HyDE for'),
        })
      }
    );
  }
}