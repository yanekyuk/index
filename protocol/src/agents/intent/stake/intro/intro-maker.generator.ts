import { BaseLangChainAgent } from "../../../../lib/langchain/langchain";
import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const SYSTEM_PROMPT = `You are a first message suggestion generator. Create friendly, upbeat opening messages that follow this structure:

REQUIRED STRUCTURE (name MUST come first):
1. Greeting with name: "Hi [recipient's first name]!" (always start with their name)
2. Self-introduction: "I'm [sender's first name], and I'm working on [sender's specific interest/intent]"
3. Enthusiastic connection: Express genuine excitement about their work
4. Curious question: End with a question about their work or ideas

EXAMPLE FORMAT:
"Hi Alex! I'm Sam, and I'm building [X]. I came across your work on [Y] and got really excited—it's such a cool approach! I'd love to hear how you're thinking about [Z]?"

TONE:
- Playful and positive—like reaching out to someone you genuinely find interesting
- Warm but not over-the-top
- Curious and enthusiastic
- Conversational, not formal

CRITICAL RULES:
- ALWAYS start with "Hi [first name]!" - the name must be the first thing after "Hi"
- Use ONLY explicit information provided - no assumptions, no extrapolation
- Pick ONE most relevant point from each person's interests
- Show genuine curiosity about their work
- End with a question about their work or interests
- 3-4 sentences maximum

What NOT to do:
- Don't mention "platform", "network", or "community"
- Don't use generic networking phrases like "expanding my network", "growing my connections", "building relationships"
- Don't assume background, expertise, or context not explicitly stated
- Don't use stiff phrases like "I'd love to connect" or "reach out"
- Don't be overly formal or corporate-sounding
- Don't use all available information - be selective`;

export const IntroMakerOutputSchema = z.object({
  message: z.string().describe("A friendly, playful opening message that starts with the recipient's name and shows genuine enthusiasm")
});

export type IntroMakerInput = {
  sender: {
    name: string;
    reasonings: string[];
  };
  recipient: {
    name: string;
    reasonings: string[];
  };
};

export type IntroMakerResult = z.infer<typeof IntroMakerOutputSchema>;

export class IntroMakerGenerator extends BaseLangChainAgent {
  constructor(options = {}) {
    super({
      preset: 'intro-maker',
      responseFormat: IntroMakerOutputSchema,
      temperature: 0.7, // Higher for playful, natural variety
      ...options
    });
  }

  async run(input: IntroMakerInput): Promise<IntroMakerResult> {
    const systemMsg = new SystemMessage(SYSTEM_PROMPT);
    const userMsg = new HumanMessage(this.buildUserMessage(input));

    const result = await (this as any).model.invoke([systemMsg, userMsg]);
    return result.structuredResponse;
  }

  private buildUserMessage(input: IntroMakerInput): string {
    const senderReasonings = input.sender.reasonings.length > 0
      ? input.sender.reasonings.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : '1. Working on interesting projects';

    const recipientReasonings = input.recipient.reasonings.length > 0
      ? input.recipient.reasonings.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : '1. Working on interesting projects';

    return `Generate a friendly first message from ${input.sender.name} to ${input.recipient.name}.

STRUCTURE TO FOLLOW:
1. "Hi [first name of ${input.recipient.name}]!" ← NAME MUST BE FIRST, right after "Hi"
2. "I'm [first name of ${input.sender.name}], and I'm [what they're working on]"
3. Express genuine enthusiasm about something specific from their work
4. End with a curious question about their work or ideas

${input.sender.name}'s interests (pick the MOST relevant ONE):
${senderReasonings}

${input.recipient.name}'s interests (pick the MOST relevant ONE):
${recipientReasonings}

IMPORTANT:
- ALWAYS start with "Hi [first name]!" - the recipient's name must immediately follow "Hi"
- Be playful and positive - sound genuinely excited, not corporate
- Use words like "cool", "excited", "love to hear", "curious about"
- Pick only ONE point from each list
- Use only what's explicitly stated
- End with a curious question about their work or ideas
- Write from ${input.sender.name}'s perspective (use "I")

Generate the message:`;
  }
}

export const createIntroMakerAgent = (options = {}) => new IntroMakerGenerator(options);
