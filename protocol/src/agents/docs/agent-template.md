# Agent Implementation Template

This document provides a standard template for creating new AI agents within the `protocol/src/agents` directory.

## Directory Structure

When creating a new agent, follow this structure:

```
src/agents/[domain]/
  ├── [agent-name]/
  │   ├── [agent-name].ts           # Main agent class
  │   ├── [agent-name].types.ts     # Types and Zod schemas
  │   └── [agent-name].spec.ts      # Tests
```

## Implementation Guidelines

1.  **Inheritance**: All agents must extend `BaseLangChainAgent`.
2.  **Structured Output**: Use Zod schemas to define the expected output format. **Important**: Define the Zod schema in the agent implementation file (`.ts`), NOT in the types file (`.types.ts`). The types file should only contain TypeScript interfaces.
3.  **System Prompt**: Define a clear `SYSTEM_PROMPT` constant at the top of the file. This should include:
    *   **Persona**: Who the agent is.
    *   **Task**: What the agent does.
    *   **Inputs**: What data the agent receives.
    *   **Outputs**: What the agent should produce.
    *   **Constraints**: Any strict rules or formatting requirements.
4.  **Configuration**: In the constructor, call `super()` with:
    *   `model`: The model identifier (e.g., `'openai/gpt-4o'`, `'openai/gpt-4o-mini'`).
    *   `responseFormat`: The Zod schema for the output.
    *   `temperature`: Controls randomness (0.0 for deterministic, 0.7+ for creative).

## Code Template

Copy and adapt this template for your new agent.

### 1. Types Definition (`[agent-name].types.ts`)

```typescript
// Define the interface for the agent's output. Do NOT use Zod here; Zod schemas belong in the agent implementation file.
export interface MyAgentOutput {
  /** High-level analysis of the input */
  analysis: string;
  /** Relevance score */
  score: number;
  /** List of relevant tags */
  tags: string[];
}
```

### 2. Agent Implementation (`[agent-name].ts`)

```typescript
import { BaseLangChainAgent } from "../../../lib/langchain/langchain";
import { z } from "zod";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { log } from "../../../lib/log";
import { MyAgentOutput } from "./[agent-name].types";

const SYSTEM_PROMPT = `
You are an expert [Role Name].

TASK:
Analyze the provided user input and extract [Specific Information].

INPUTS:
1. User Context: A string describing the user.
2. Content: The text to analyze.

OUTPUT RULES:
- Provide a concise analysis.
- Score the content from 0-10 based on [Criteria].
- Extract relevant tags.
`;

// Define the Zod schema locally for the agent to use
const MyAgentOutputSchema = z.object({
  analysis: z.string().describe("High-level analysis of the input"),
  score: z.number().min(0).max(10).describe("Relevance score"),
  tags: z.array(z.string()).describe("List of relevant tags"),
});

export class MyAgent extends BaseLangChainAgent {
  constructor() {
    super({
      model: 'openai/gpt-4o', // Choose appropriate model
      responseFormat: MyAgentOutputSchema, // Enforce structured output
      temperature: 0.1, // Low temperature for deterministic tasks
    });
  }

  /**
   * Runs the agent on the given input.
   * 
   * @param content - The main content to process.
   * @param context - Additional context (optional).
   */
  async run(content: string, context: string): Promise<MyAgentOutput | null> {
    log.info(`[MyAgent] Processing content...`);

    const prompt = `
      # Context
      ${context}

      # Content
      ${content}
      
      Analyze this content according to your instructions.
    `;

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt)
    ];

    try {
      // Invoke the model with the messages
      const result = await this.model.invoke({ messages });
      
      // The result.structuredResponse is typed as 'any' in the base class, 
      // but validated against the schema we passed in the constructor.
      const output = result.structuredResponse as MyAgentOutput;

      log.info(`[MyAgent] Analysis complete. Score: ${output.score}`);
      return output;
    } catch (error) {
      log.error("[MyAgent] Error during execution", { error });
      return null;
    }
  }
}
```

### 3. Agent Tests (`[agent-name].spec.ts`)

Create an integration test script to verify the agent's behavior with real LLM calls.

```typescript
import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { MyAgent } from './[agent-name]';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

describe('MyAgent Tests', () => {
  let agent: MyAgent;

  beforeAll(() => {
    if (!process.env.OPENROUTER_API_KEY) {
      console.warn("⚠️  No OPENROUTER_API_KEY found. Live LLM tests might fail.");
    }
    agent = new MyAgent();
  });

  test('Happy Path', async () => {
    try {
      const content = "Test content that should pass validation.";
      const context = "User context data.";
      
      const res = await agent.run(content, context);
      console.log("Result:", JSON.stringify(res, null, 2));

      expect(res).toBeDefined();
      if (res) {
        expect(res.score).toBeGreaterThan(5);
      }
    } catch (err) {
      console.error("❌ Error:", err);
      throw err;
    }
  });
});
```

## Best Practices

*   **Prompt Engineering**: Iterate on your `SYSTEM_PROMPT`. Be specific about edge cases.
*   **Logging**: Use `log.info` and `log.error` to track agent execution and failures.
*   **Error Handling**: Always wrap model invocations in try-catch blocks to handle API failures or schema validation errors gracefully.
*   **Type Safety**: Keep your Zod schema and TypeScript interface in sync manually or via tests. 
