# Graph Implementation Template

This template outlines the standard structure for creating `LangGraph` workflows in the protocol. We use a **Factory Pattern** to instantiate graphs with necessary dependencies (Database, Embedder, etc.).

## File Structure

For a graph named `example`:
- `example.graph.ts`: The Graph Factory and definition.
- `example.graph.state.ts`: The LangGraph annotation state definition.
- `example.graph.spec.ts`: Unit tests for the graph.

## 1. State Definition (`example.graph.state.ts`)

Define the state schema using `Annotation.Root`. This state acts as the central bus for data flowing through the graph.

```typescript
import { Annotation } from "@langchain/langgraph";

export const ExampleGraphState = Annotation.Root({
  // --- Inputs (Required at start) ---
  userId: Annotation<string>,
  input: Annotation<string>,

  // --- Intermediate State ---
  intermediateResult: Annotation<any>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  // --- Output ---
  finalOutput: Annotation<any>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),
});
```

## 2. Graph Definition (`example.graph.ts`)

Create a Factory class to build and compile the graph.

### ⚠️ Critical Rule: Side-Effects (DB & Embedding)
**All Database and Embedder operations should be done in Graph Nodes (or Tools called by Nodes), NOT inside the Agents themselves.**
- **Agents** should primarily focus on reasoning, prompt chaining, and data transformation.
- **Graph Nodes** should handle side effects, persistence (DB writes), and external integrations (Embedding).

```typescript
import { StateGraph, START, END } from "@langchain/langgraph";
import { ExampleGraphState } from "./example.graph.state";
import { Database } from "../../interfaces/database.interface";
import { Embedder } from "../../interfaces/embedder.interface";
import { log } from "../../../log";

/**
 * Factory class to build and compile the Example Graph.
 */
export class ExampleGraphFactory {
  constructor(
    private database: Database,
    private embedder: Embedder
  ) { }

  public createGraph() {
    // 1. Instantiate Agents (Pure reasoning logic preferrably)
    // const agent = new MyAgent(); // No DB/Embedder injected

    // --- NODE DEFINITIONS ---

    /**
     * Node 1: Processing
     * Orchestrates agent calls, embeddings, and DB interactions.
     */
    const processingNode = async (state: typeof ExampleGraphState.State) => {
      log.info("[Graph:Example] Processing...");
      
      // 1. Call Agent (Reasoning)
      // const result = await agent.invoke(state.input);

      // 2. Generate Embedding (if needed)
      // const embedding = await this.embedder.generate(result.text);

      // 3. Perform DB Operations (Persistence)
      // await this.database.create('collection', { data: result, embedding });

      return {
        intermediateResult: "processed"
      };
    };

    // --- GRAPH ASSEMBLY ---

    const workflow = new StateGraph(ExampleGraphState)
      .addNode("process", processingNode)
      .addEdge(START, "process")
      .addEdge("process", END);

    return workflow.compile();
  }
}
```

## 3. Testing (`example.graph.spec.ts`)

Always include a spec file that mocks the `Database` and `Embedder`.

```typescript
import { describe, expect, it, beforeAll } from "bun:test";
import { ExampleGraphFactory } from "./example.graph";

const mockDatabase = { ... } as unknown as Database;
const mockEmbedder = { ... } as unknown as Embedder;

describe('ExampleGraph', () => {
  let graphRunner: any;

  beforeAll(() => {
    const factory = new ExampleGraphFactory(mockDatabase, mockEmbedder);
    graphRunner = factory.createGraph();
  });

  it('should run successfully', async () => {
    const res = await graphRunner.invoke({ ... });
    expect(res).toBeDefined();
  });
});
```
