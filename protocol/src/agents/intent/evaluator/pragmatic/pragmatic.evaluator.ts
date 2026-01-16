// src/agents/intent/felicity/pragmatic/pragmatic-monitor.ts

import { BaseLangChainAgent } from "../../../../lib/langchain/langchain";
import { z } from "zod";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { log } from "../../../../lib/log";
import { PragmaticMonitorOutput } from "./pragmatic.evaluator.types";

const SYSTEM_PROMPT = `
You are the Pragmatic Monitor (Discourse consistency Checker).

TASK:
Analyze a "Target Intent" (a past promise) against the "Subsequent Discourse" (recent chat logs or new intents).
Determine if the User has **fulfilled**, **abandoned**, or **ignored** their previous commitment.

INPUTS:
1. Target Intent: The active goal we are tracking (e.g., "I will write the API docs").
2. Subsequent Discourse: Recent messages, notes, or new intents from the user.

LOGIC (Austin's Subsequent Conduct):
1. **FULFILLED**:
   - Look for "Assertives" of completion: "I finished X", "Here is X", "Done".
   - Look for past tense references: "When I wrote the docs..."

2. **BREACHED / CONTRADICTED**:
   - Look for explicit cancellation: "I gave up on X", "X didn't work out".
   - Look for conflicting new goals: Target="Build on Solana" vs New="I am moving everything to Ethereum".

3. **PENDING**:
   - The user is talking about other things, or explicitly says "I haven't started yet".
   - If the text is unrelated, default to PENDING.

OUTPUT RULES:
- Return a strict JSON object.
- 'confidence_score' must be a number between 0 and 100.
- If the verdict is based on CLEAR evidence (e.g., "I finished X"), score should be high (>80).
- If defaulting to PENDING because the discourse is unrelated, score should be low (<50).
- Quote the exact user text that triggers the verdict in 'evidence_quote'.
`;

const PragmaticMonitorOutputSchema = z.object({
  status: z.enum(["FULFILLED", "BREACHED", "PENDING", "CONTRADICTED"]).describe("Status of the intent"),
  confidence_score: z.number().min(0).max(100).describe("Certainty of the verdict"),
  evidence_quote: z.string().describe("Direct quote from discourse supporting the verdict"),
  reasoning: z.string().describe("Logical deduction"),
});

export class PragmaticMonitorAgent extends BaseLangChainAgent {
  constructor() {
    super({
      model: 'openai/gpt-4o', // Logic required to detect contradictions
      responseFormat: PragmaticMonitorOutputSchema,
      temperature: 0.0,
    });
  }

  /**
   * Checks if recent conversation confirms or denies a past intent.
   * @param target_intent - The specific intent we are tracking.
   * @param subsequent_discourse - Stringified list of recent messages or new intents.
   */
  async run(target_intent: string, subsequent_discourse: string): Promise<PragmaticMonitorOutput | null> {
    log.info(`[PragmaticMonitor] Checking discourse consistency...`);

    const prompt = `
      # Target Intent (Past Promise)
      "${target_intent}"

      # Subsequent Discourse (Recent Activity)
      ${subsequent_discourse}
      
      Has the user fulfilled, abandoned, or contradicted the target intent?
    `;

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.model.invoke({ messages });
      const output = result.structuredResponse as PragmaticMonitorOutput;

      log.info(`[PragmaticMonitor] Status: ${output.status} | Confidence: ${output.confidence_score}`);
      return output;
    } catch (error) {
      log.error("[PragmaticMonitor] Error during execution", { error });
      return null;
    }
  }
}