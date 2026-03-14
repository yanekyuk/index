/**
 * Invite Generator Agent
 *
 * Generates contextual, editable invite messages for ghost users.
 * Produces warm, concise messages (~3-5 sentences) referencing why two
 * users were matched, with optional referrer mention.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createModel } from "./model.config";

const model = createModel("inviteGenerator");

const InviteInputSchema = z.object({
  recipientName: z.string(),
  senderName: z.string(),
  opportunityInterpretation: z.string(),
  senderIntents: z.array(z.string()),
  recipientIntents: z.array(z.string()),
  referrerName: z.string().optional(),
});

const InviteOutputSchema = z.object({
  message: z.string().describe("The invite message text, ready to edit and send"),
});

export type InviteInput = z.infer<typeof InviteInputSchema>;
export type InviteOutput = z.infer<typeof InviteOutputSchema>;

const SYSTEM_PROMPT = `You generate short, warm invite messages for a professional networking platform called Index.

The sender wants to reach out to someone whose profile matched theirs. Generate a conversational message (~3-5 sentences) that:
- Greets the recipient by name
- Briefly explains why they were matched (reference the opportunity interpretation)
- Mentions the sender's relevant intent or interest
- If a referrer is provided, naturally mentions that the referrer suggested they connect
- Ends with an open question or gentle CTA
- Uses a warm but professional tone — not salesy, not stiff

Do NOT include a subject line. This is a chat message, not an email.
Do NOT use placeholder brackets like [Name]. Use the actual names provided.`;

/**
 * Generates a contextual invite message for a ghost user.
 * @param input - Context about sender, recipient, and opportunity
 * @returns Generated invite message text
 */
export async function generateInviteMessage(input: InviteInput): Promise<InviteOutput> {
  const validated = InviteInputSchema.parse(input);

  const structuredModel = model.withStructuredOutput(InviteOutputSchema);

  const userPrompt = `Generate an invite message with this context:
- Sender: ${validated.senderName}
- Recipient: ${validated.recipientName}
- Why they matched: ${validated.opportunityInterpretation}
- Sender's interests: ${validated.senderIntents.join(', ') || 'Not specified'}
- Recipient's interests: ${validated.recipientIntents.join(', ') || 'Not specified'}${validated.referrerName ? `\n- Referred by: ${validated.referrerName}` : ''}`;

  const result = await structuredModel.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(userPrompt),
  ]);

  return result;
}
