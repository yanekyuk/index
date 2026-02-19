import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

export const FeedbackAnalysisSchema = z.object({
  explanation: z.string().describe("A short paragraph (2-3 sentences) analyzing the root cause of the feedback."),
  labels: z.array(z.string()).describe("List of labels describing the issue, e.g., 'refusal', 'tone', 'repetition', 'loop', 'hallucination', 'factual_error', 'irrelevant', 'incomplete'. Prefer concise snake_case."),
});

export type FeedbackAnalysis = z.infer<typeof FeedbackAnalysisSchema>;

export async function analyzeFeedback(
  feedback: string,
  conversation: any[]
): Promise<FeedbackAnalysis> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const model = new ChatOpenAI({
    modelName: "google/gemini-2.5-flash",
    apiKey: process.env.OPENROUTER_API_KEY,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
    },
    temperature: 0,
  });

  const structuredModel = model.withStructuredOutput(FeedbackAnalysisSchema);

  const conversationText = conversation
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join("\n");

  const prompt = `
You are an expert AI feedback analyzer.
Analyze the following user feedback and conversation history to identify the root cause and categorize the issue.

Feedback: "${feedback}"

Conversation History:
${conversationText}

Instructions:
1. Analyze the feedback in the context of the conversation.
2. Identify the root cause of the issue.
3. Assign relevant labels focusing on behavior (e.g., refusal, tone, repetition, loop) and quality (e.g., hallucination, factual_error, irrelevant, incomplete).
4. Use concise snake_case for labels.
5. Provide a short explanation (2-3 sentences).

Output the result in JSON format with "explanation" and "labels".
`;

  const result = await structuredModel.invoke(prompt);
  return result;
}
