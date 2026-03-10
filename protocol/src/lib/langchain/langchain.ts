import { ChatOpenAI } from "@langchain/openai"; // Implementation detail: OpenRouter is OpenAI compatible
import { CallbackHandler } from "langfuse-langchain";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { Runnable, RunnableConfig } from "@langchain/core/runnables";

/**
 * Creates a Langfuse callback handler for observability.
 * @param sessionId - The session ID to trace.
 * @param metadata - Additional metadata for the trace.
 * @returns A configured CallbackHandler instance.
 */
function createLangfuseHandler(sessionId: string, metadata: Record<string, any>) {
  return new CallbackHandler({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY || "",
    secretKey: process.env.LANGFUSE_SECRET_KEY || "",
    baseUrl: process.env.LANGFUSE_BASE_URL || "https://us.cloud.langfuse.com",
    sessionId,
    metadata
  });
}

/**
 * Represents a request context for an agent execution.
 */
export interface AgentRequest {
  /** The messages to process. */
  messages: BaseMessage[];
  /** 
   * The specific model instance to use for this call.
   * Middleware can override this to switch models dynamically.
   */
  model?: BaseChatModel | Runnable;
  /** Additional runtime options. */
  options?: any;
}

/** Function signature for the next middleware in the chain. */
export type NextHandler = (request: AgentRequest) => Promise<AIMessage | any>;

/**
 * Definition of a middleware component.
 */
export interface MiddlewareDefinition {
  /** The name of the middleware. */
  name: string;
  /**
   * Wraps the model call to intercept request/response.
   * @param request - The agent request.
   * @param next - The next handler in the chain.
   */
  wrapModelCall: (request: AgentRequest, next: NextHandler) => Promise<AIMessage | any>;
}

/**
 * Helper to define middleware with type safety.
 * @param def - The middleware definition.
 */
export function createMiddleware(def: MiddlewareDefinition): MiddlewareDefinition {
  return def;
}

/**
 * Standard configuration options for Agent LLM calls.
 */
export interface AgentModelOptions {
  /** Override the model ID (e.g. "openai/gpt-4") */
  model?: string;

  /** Sampling temperature (0-2) */
  temperature?: number;

  /** Maximum number of tokens to generate */
  maxTokens?: number;

  /** Nucleus sampling probability */
  topP?: number;

  /** Request timeout in milliseconds */
  timeout?: number;

  /** Maximum number of retries */
  maxRetries?: number;

  /** Enable streaming for token-by-token responses */
  streaming?: boolean;

  /** OpenRouter reasoning configuration */
  reasoning?: {
    exclude?: boolean;
    effort?: 'minimal' | 'low' | 'medium' | 'high';
    max_tokens?: number;
  };

  /** Provider-specific or extra arguments passed to modelKwargs */
  modelKwargs?: Record<string, any>;

  /** Middleware chain to execute */
  middleware?: MiddlewareDefinition[];

  /** Tools (optional, for agent compatibility) */
  tools?: any[];

  /** Zod Schema or JSON schema for structured output */
  responseFormat?: any;
}

/**
 * Internal helper to create a base ChatOpenAI instance for OpenRouter.
 * @param preset - The model preset identifier.
 * @param options - Configuration options.
 */
function createBaseOpenRouterModel(preset: string | undefined, options: AgentModelOptions = {}): ChatOpenAI {
  const { model, temperature, maxTokens, topP, timeout, maxRetries, streaming = false, reasoning, modelKwargs } = options;

  const finalModelKwargs = { ...modelKwargs };
  if (reasoning) {
    finalModelKwargs.reasoning = reasoning;
  }

  // If 'model' is provided, use it. Otherwise use preset.
  const modelName = model || (preset ? `@preset/${preset}` : undefined);
  if (!modelName) throw new Error("Model or preset must be defined");

  return new ChatOpenAI({
    model: modelName,
    streaming,
    apiKey: process.env.OPENROUTER_API_KEY!,
    configuration: {
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    },
    temperature,
    maxTokens,
    topP,
    timeout,
    maxRetries,
    modelKwargs: Object.keys(finalModelKwargs).length > 0 ? finalModelKwargs : undefined,
  });
}

/**
 * Creates an agent runnable with middleware support.
 * Returns a Runnable-compatible object that executes the middleware chain.
 * 
 * Usage:
 * ```ts
 * const agent = createAgent({ model: "gpt-4", middleware: [...] });
 * await agent.invoke(messages);
 * ```
 */
export function createAgent(options: AgentModelOptions & { preset?: string }): Runnable {
  let defaultModel: BaseChatModel | Runnable = createBaseOpenRouterModel(options.preset ?? options.model, options);

  // Apply structured output if format is provided
  if (options.responseFormat) {
    // We assume defaultModel is a BaseChatModel (ChatOpenAI)
    defaultModel = (defaultModel as ChatOpenAI).withStructuredOutput(options.responseFormat);
  }

  const middlewares = options.middleware || [];

  // The core execution logic: just call the model
  const coreHandler: NextHandler = async (req) => {
    const modelToUse = req.model || defaultModel;
    // Ensure we pass messages correctly. verify it's a Runnable or ChatModel
    if ('invoke' in modelToUse) {
      // If modelToUse is a Runnable (like structured output), it returns the parsed object
      // If it's a ChatModel, it returns AIMessage
      const result = await modelToUse.invoke(req.messages, req.options);

      // Normalize response to ensure we have a consistent access pattern if needed?
      // The user example shows: result.structuredResponse
      // But .withStructuredOutput usually returns the object directly.
      // If we want to match `result.structuredResponse`, we might need to wrap it.
      // User snippet: `console.log(result.structuredResponse);`
      // So createAgent should returns an object `{ structuredResponse: ... }` if structured?
      // OR LangChain's createAgent returns something that has it?

      // LangChain's agents usually return { output: ..., intermediateSteps: ... }
      // If we want to support the user's specific access pattern:
      if (options.responseFormat) {
        return { structuredResponse: result }; // Wrap it to match user expectation
      }
      return result;
    }
    throw new Error("Invalid model in request");
  };

  // Compose middleware
  // We wrap coreHandler with the last middleware, then the one before, etc.
  const chain = middlewares.reduceRight((next: NextHandler, mw) => {
    return async (req: AgentRequest) => {
      return mw.wrapModelCall(req, next);
    };
  }, coreHandler);

  // Return a Runnable-like object
  return {
    invoke: async (input: BaseMessage[] | any, config?: RunnableConfig) => {
      // Normalize input
      let messages: BaseMessage[] = [];
      if (Array.isArray(input)) {
        messages = input;
      } else if (input.messages) {
        messages = input.messages;
      } else {
        messages = input;
      }

      const request: AgentRequest = {
        messages,
        model: defaultModel,
        options: config
      };

      return await chain(request);
    },
    lc_serializable: true,
    lc_namespace: ["langchain", "agents"]
  } as unknown as Runnable;
}

/**
 * Base abstract class for LangChain agents.
 * Encapsulates the model instance and its configuration options.
 */
export abstract class BaseLangChainAgent {
  /** The executable LangChain runnable (model + middleware). */
  protected model: Runnable;

  /** Configuration options for this agent. */
  protected options: AgentModelOptions;

  /**
   * @param options - Configuration options for the agent.
   */
  constructor(options: AgentModelOptions & { preset?: string }) {
    this.options = options;
    this.model = createAgent(options);
  }
}

// ----------------------------------------------------------------------------
/**
 * Agnostic wrapper for LLM calls, defaulting to OpenRouter.
 * Uses direct model instantiation for stability.
 * @deprecated Use createAgent instead.
 */
export function traceableLlm(preset: string, metadata: Record<string, any>) {
  return async (messages: Array<{ role: string, content: string }>, options: AgentModelOptions = {}) => {
    // Direct usage of Base Model (ChatOpenAI wrapper)
    const llm = createBaseOpenRouterModel(preset, options);

    // We treat 'messages' as compatible with LangChain inputs (Role/Content)
    const response = await llm.invoke(messages, { runName: preset });
    return response;
  };
}

/**
 * Agnostic wrapper for Structured LLM calls.
 * Uses direct model instantiation for stability.
 * @deprecated Use createAgent with responseFormat instead.
 */
export function traceableStructuredLlm(preset: string, metadata: Record<string, any>, options: AgentModelOptions = {}) {
  const baseModel = createBaseOpenRouterModel(preset, options);

  return async (messages: Array<{ role: string, content: string }>, schema: any) => {
    const structuredLlm = baseModel.withStructuredOutput(schema, {
      name: schema.name || 'structured_output'
    });

    const response = await structuredLlm.invoke(messages, {
      runName: preset
    });
    return response;
  };
}

/**
 * Wraps an LLM call function with timeout and retry logic.
 * @param llmCall - The LLM call function to wrap.
 * @param options - Configuration options for timeout and retries.
 * @returns Wrapped function with timeout and retry capabilities.
 * @deprecated Use createRetryTool middleware instead.
 */
export function withTimeoutAndRetry<T extends (...args: any[]) => Promise<any>>(
  llmCall: T,
  options: {
    timeoutMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
  } = {}
): T {
  const {
    timeoutMs = 30000, // 30 seconds default
    maxRetries = 2,
    retryDelayMs = 1000
  } = options;

  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`LLM call timeout after ${timeoutMs}ms`)), timeoutMs);
        });

        const result = await Promise.race([
          llmCall(...args),
          timeoutPromise
        ]);

        return result as ReturnType<T>;
      } catch (error: any) {
        lastError = error;
        const isTimeout = error?.message?.includes('timeout');
        const isLastAttempt = attempt === maxRetries;

        if (isLastAttempt) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s...
        const delay = retryDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('LLM call failed after retries');
  }) as T;
}
