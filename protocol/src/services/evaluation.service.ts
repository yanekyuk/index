/**
 * Evaluation Service
 *
 * Manages running evaluations, state tracking, and event emission for SSE streaming.
 */

import { EventEmitter } from "events";
import { log } from "../lib/log";
import type {
  GeneratedScenario,
  ChatEvaluationResult,
} from "../lib/protocol/graphs/chat.evaluator";
import { runChatEvaluationSuite, ScenarioGenerator, type ChatAgentInterface } from "../lib/protocol/graphs/chat.evaluator";

const logger = log.service.from("evaluation");

export interface EvaluationEvent {
  type:
    | "suite_started"
    | "suite_completed"
    | "scenario_started"
    | "scenario_completed"
    | "turn_started"
    | "turn_completed"
    | "evaluation_started"
    | "evaluation_completed"
    | "error";
  timestamp: number;
  data: any;
}

export interface EvaluationRunConfig {
  scenarioCount?: number;
  maxTurns?: number;
  timeoutMs?: number;
  verbose?: boolean;
}

export interface EvaluationRun {
  id: string;
  status: "running" | "completed" | "error" | "cancelled";
  config: EvaluationRunConfig;
  startTime: number;
  endTime?: number;
  scenarios?: GeneratedScenario[];
  results?: ChatEvaluationResult[];
  summary?: any;
  error?: string;
}

/**
 * Singleton service to manage evaluation runs
 */
export class EvaluationService extends EventEmitter {
  private static instance: EvaluationService;
  private currentRun: EvaluationRun | null = null;
  private runHistory: EvaluationRun[] = [];
  private maxHistorySize = 10;
  private cancelRequested = false;
  private generatedScenarios: GeneratedScenario[] = [];
  private chatAgent: ChatAgentInterface | null = null;
  private userId: string | null = null; // Store user ID for evaluation context

  private constructor() {
    super();
  }

  static getInstance(): EvaluationService {
    if (!EvaluationService.instance) {
      EvaluationService.instance = new EvaluationService();
    }
    return EvaluationService.instance;
  }

  /**
   * Store generated scenarios for later use
   */
  setScenarios(scenarios: GeneratedScenario[], agent: ChatAgentInterface, userId: string): void {
    this.generatedScenarios = scenarios;
    this.chatAgent = agent;
    this.userId = userId;
  }

  /**
   * Get stored scenarios
   */
  getScenarios(): GeneratedScenario[] {
    return this.generatedScenarios;
  }

  /**
   * Run a single scenario by ID
   */
  async runScenario(scenarioId: string): Promise<void> {
    if (!this.chatAgent) {
      throw new Error("No chat agent configured");
    }

    const scenario = this.generatedScenarios.find((s) => s.id === scenarioId);
    if (!scenario) {
      throw new Error("Scenario not found");
    }

    const { runChatEvaluation } = await import("../lib/protocol/graphs/chat.evaluator");

    const result = await runChatEvaluation(scenario, this.chatAgent, {
      verbose: false,
      maxTurns: 3,
      timeoutMs: 90000,
      userId: this.userId || undefined, // Pass the real user ID
      onEvent: (event: any) => {
        this.emitEvent({
          ...event,
          timestamp: Date.now(),
        });
      },
    });
  }

  /**
   * Get current running evaluation
   */
  getCurrentRun(): EvaluationRun | null {
    return this.currentRun;
  }

  /**
   * Get evaluation history
   */
  getHistory(): EvaluationRun[] {
    return this.runHistory;
  }

  /**
   * Check if evaluation is currently running
   */
  isRunning(): boolean {
    return this.currentRun?.status === "running";
  }

  /**
   * Request cancellation of current run
   */
  requestCancel(): void {
    if (this.isRunning()) {
      this.cancelRequested = true;
      this.emitEvent({
        type: "error",
        timestamp: Date.now(),
        data: { message: "Cancellation requested" },
      });
    }
  }

  /**
   * Start a new evaluation run
   */
  async startEvaluation(
    chatAgent: ChatAgentInterface,
    config: EvaluationRunConfig = {}
  ): Promise<EvaluationRun> {
    if (this.isRunning()) {
      throw new Error("Evaluation already running");
    }

    this.cancelRequested = false;

    const runId = `eval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const run: EvaluationRun = {
      id: runId,
      status: "running",
      config,
      startTime: Date.now(),
    };

    this.currentRun = run;

    try {
      // Use pre-generated scenarios if available, otherwise generate new ones
      let scenarios: GeneratedScenario[];
      
      if (this.generatedScenarios.length > 0) {
        scenarios = this.generatedScenarios;
        logger.info("Using pre-generated scenarios", { count: scenarios.length });
      } else {
        const generator = new ScenarioGenerator();
        const scenarioCount = config.scenarioCount ?? 10;
        scenarios = await generator.generateBatch(scenarioCount);
        this.generatedScenarios = scenarios;
        this.chatAgent = chatAgent;
      }

      run.scenarios = scenarios;

      this.emitEvent({
        type: "suite_started",
        timestamp: Date.now(),
        data: {
          runId,
          totalScenarios: scenarios.length,
          config: {
            maxTurns: config.maxTurns ?? 3,
            timeoutMs: config.timeoutMs ?? 90000,
          },
        },
      });

      // Run test suite with event streaming (parallel execution)
      const { results, summary } = await runChatEvaluationSuite(scenarios, chatAgent, {
        verbose: config.verbose ?? false,
        parallel: true, // Run scenarios in parallel for speed
        maxTurns: config.maxTurns ?? 3,
        timeoutMs: config.timeoutMs ?? 90000,
        userId: this.userId || undefined, // Pass the real user ID
        onEvent: (event: any) => {
          // Check for cancellation
          if (this.cancelRequested) {
            throw new Error("Evaluation cancelled by user");
          }

          // Forward events
          this.emitEvent({
            ...event,
            timestamp: Date.now(),
            data: { ...event.data, runId },
          });
        },
      });

      // Complete
      run.results = results;
      run.summary = summary;
      run.status = "completed";
      run.endTime = Date.now();

      this.emitEvent({
        type: "suite_completed",
        timestamp: Date.now(),
        data: {
          runId,
          summary,
          duration: run.endTime - run.startTime,
        },
      });

      // Add to history
      this.addToHistory(run);

      return run;
    } catch (error) {
      run.status = this.cancelRequested ? "cancelled" : "error";
      run.error = error instanceof Error ? error.message : String(error);
      run.endTime = Date.now();

      this.emitEvent({
        type: "error",
        timestamp: Date.now(),
        data: {
          runId,
          error: run.error,
        },
      });

      this.addToHistory(run);

      throw error;
    } finally {
      this.currentRun = null;
      this.cancelRequested = false;
    }
  }

  /**
   * Emit an event to all listeners
   */
  private emitEvent(event: EvaluationEvent): void {
    this.emit("evaluation_event", event);
  }

  /**
   * Add run to history (keeping only most recent)
   */
  private addToHistory(run: EvaluationRun): void {
    this.runHistory.unshift(run);
    if (this.runHistory.length > this.maxHistorySize) {
      this.runHistory = this.runHistory.slice(0, this.maxHistorySize);
    }
  }
}
