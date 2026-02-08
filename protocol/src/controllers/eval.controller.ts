/**
 * Evaluation Controller
 *
 * Provides SSE streaming endpoint and control API for chat agent evaluations.
 */

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { EvaluationService, type EvaluationEvent, type EvaluationRunConfig } from '../services/evaluation.service';
import { ChatGraphFactory } from '../lib/protocol/graphs/chat/chat.graph';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import type { ChatAgentInterface } from '../lib/protocol/graphs/chat/chat.evaluator';
import { ChatScenarioGenerator } from '../lib/protocol/graphs/chat/chat.evaluator';
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";

const logger = log.controller.from("eval");

/**
 * Create a chat agent adapter for evaluation
 * @param userId - The authenticated user ID to run evaluations as (uses their real data)
 */
async function createChatAgent(userId: string): Promise<ChatAgentInterface> {
  const database = new ChatDatabaseAdapter();
  const embedder = new EmbedderAdapter();
  const scraper = new ScraperAdapter();
  const factory = new ChatGraphFactory(database, embedder, scraper);
  
  let sessionId = crypto.randomUUID();
  
  logger.info("[eval] Creating chat agent for user", { userId });
  
  return {
    async chat(message: string, options?: { userId?: string; sessionId?: string; indexId?: string }) {
      try {
        const graph = factory.createGraph();
        const result = await graph.invoke({
          userId: options?.userId || userId, // Use the real user ID
          messages: [new HumanMessage(message)],
          sessionId: options?.sessionId || sessionId,
          indexId: options?.indexId,
        });

        // Extract final response
        const lastMessage = result.messages[result.messages.length - 1];
        const response = typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);

        // Extract tool calls
        const toolCalls: Array<{ tool: string; args: any; result: any }> = [];
        for (const msg of result.messages) {
          if ("tool_calls" in msg && Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls) {
              toolCalls.push({
                tool: tc.name || "unknown",
                args: tc.args || {},
                result: null,
              });
            }
          }
        }

        return {
          response,
          rawMessages: result.messages,
          toolCalls,
        };
      } catch (error) {
        return {
          response: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    
    reset() {
      sessionId = crypto.randomUUID();
    },
  };
}

/**
 * Evaluation Controller
 */
@Controller('/eval')
export class EvalController {
  private evaluationService = EvaluationService.getInstance();

  /**
   * SSE endpoint - streams evaluation events in real-time
   */
  @Get('/stream')
  async stream(req: Request, _user?: AuthenticatedUser) {
    // Manual token validation from query params (EventSource doesn't support headers)
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    
    if (!token) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Basic token validation (in production, verify with Privy)
    logger.info('[eval/stream] SSE connection established');

    const stream = new ReadableStream({
      start: (controller) => {
        const encoder = new TextEncoder();
        
        const sendEvent = (event: EvaluationEvent) => {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        };

        // Forward events from service
        this.evaluationService.on('evaluation_event', sendEvent);

        // Keep-alive ping every 30s
        const keepAlive = setInterval(() => {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        }, 30000);

        // Cleanup on close
        req.signal.addEventListener('abort', () => {
          this.evaluationService.off('evaluation_event', sendEvent);
          clearInterval(keepAlive);
          controller.close();
          logger.info('[eval/stream] SSE connection closed');
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  /**
   * Start evaluation
   */
  @Post('/start')
  @UseGuards(AuthGuard)
  async start(req: Request, user: AuthenticatedUser) {
    try {
      const body = (await req.json()) as EvaluationRunConfig;
      logger.info('[eval/start] Starting evaluation', { userId: user.id, config: body });

      const chatAgent = await createChatAgent(user.id); // Use real user's data

      // Start evaluation in background
      this.evaluationService
        .startEvaluation(chatAgent, body)
        .then((run) => {
          logger.info('[eval/start] Evaluation completed', { runId: run.id, status: run.status });
        })
        .catch((error) => {
          logger.error('[eval/start] Evaluation failed', { error });
        });

      return Response.json({ message: 'Evaluation started' });
    } catch (error) {
      logger.error('[eval/start] Failed to start evaluation', { userId: user.id, error });
      return Response.json(
        { error: error instanceof Error ? error.message : 'Failed to start evaluation' },
        { status: 500 }
      );
    }
  }

  /**
   * Stop evaluation
   */
  @Post('/stop')
  @UseGuards(AuthGuard)
  async stop(_req: Request, user: AuthenticatedUser) {
    try {
      logger.info('[eval/stop] Stopping evaluation', { userId: user.id });
      this.evaluationService.requestCancel();
      return Response.json({ message: 'Stop requested' });
    } catch (error) {
      logger.error('[eval/stop] Failed to stop evaluation', { userId: user.id, error });
      return Response.json(
        { error: error instanceof Error ? error.message : 'Failed to stop evaluation' },
        { status: 500 }
      );
    }
  }

  /**
   * Get current evaluation status
   */
  @Get('/status')
  @UseGuards(AuthGuard)
  async status(_req: Request, user: AuthenticatedUser) {
    try {
      logger.info('[eval/status] Getting status', { userId: user.id });
      const currentRun = this.evaluationService.getCurrentRun();
      return Response.json({ run: currentRun });
    } catch (error) {
      logger.error('[eval/status] Failed to get status', { userId: user.id, error });
      return Response.json(
        { error: error instanceof Error ? error.message : 'Failed to get status' },
        { status: 500 }
      );
    }
  }

  /**
   * Generate scenarios without running them
   */
  @Post('/generate-scenarios')
  @UseGuards(AuthGuard)
  async generateScenarios(req: Request, user: AuthenticatedUser) {
    try {
      const body = (await req.json()) as { scenarioCount?: number };
      logger.info("[eval/generate-scenarios] Generating scenarios", { userId: user.id, config: body });

      const generator = new ChatScenarioGenerator();
      
      const scenarioCount = body.scenarioCount ?? 10;
      const scenarios = await generator.generateBatch(scenarioCount);

      // Create and store chat agent for the authenticated user
      logger.info("[eval/generate-scenarios] Creating chat agent", { userId: user.id });
      const chatAgent = await createChatAgent(user.id); // Use real user's data
      logger.info("[eval/generate-scenarios] Chat agent ready");
      
      // Store in service for later individual runs
      this.evaluationService.setScenarios(scenarios, chatAgent, user.id); // Pass user ID

      // Map to simpler format for frontend
      const simplifiedScenarios = scenarios.map((s) => ({
        id: s.id,
        need: s.need.id,
        persona: s.persona.id,
        message: s.generatedMessage,
      }));

      return Response.json({ scenarios: simplifiedScenarios });
    } catch (error) {
      logger.error("[eval/generate-scenarios] Failed", { 
        userId: user.id, 
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
        } : error 
      });
      return Response.json(
        { error: error instanceof Error ? error.message : "Failed to generate scenarios" },
        { status: 500 }
      );
    }
  }

  /**
   * Run a single scenario
   */
  @Post('/run-scenario')
  @UseGuards(AuthGuard)
  async runScenario(req: Request, user: AuthenticatedUser) {
    try {
      const body = (await req.json()) as { scenarioId: string };
      logger.info("[eval/run-scenario] Running individual scenario", { userId: user.id, scenarioId: body.scenarioId });

      // Run in background
      this.evaluationService
        .runScenario(body.scenarioId)
        .then(() => {
          logger.info("[eval/run-scenario] Scenario completed", { scenarioId: body.scenarioId });
        })
        .catch((error) => {
          logger.error("[eval/run-scenario] Scenario failed", { scenarioId: body.scenarioId, error });
        });

      return Response.json({ message: "Scenario started" });
    } catch (error) {
      logger.error("[eval/run-scenario] Failed", { userId: user.id, error });
      return Response.json(
        { error: error instanceof Error ? error.message : "Failed to run scenario" },
        { status: 500 }
      );
    }
  }
}
