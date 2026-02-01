import { StateGraph, START, END } from "@langchain/langgraph";
import {
  IndexGraphState,
  IntentForIndexing,
  IndexMemberContext,
  AssignmentResult,
} from "./index.graph.state";
import { IntentIndexer } from "../../agents/index/intent.indexer";
import { IndexGraphDatabase } from "../../interfaces/database.interface";
import { log } from "../../../log";

const logger = log.graph.from("index.graph.ts");
const QUALIFICATION_THRESHOLD = 0.7;

/**
 * Factory class to build and compile the Index (Intent–Index Assignment) Graph.
 *
 * Flow:
 * 1. prep – Load intent + index/member context; set skipEvaluation if no prompts.
 * 2. evaluate – Call IntentIndexer (or auto-assign if no prompts).
 * 3. execute – Assign or unassign intent to index.
 */
export class IndexGraphFactory {
  constructor(private database: IndexGraphDatabase) {}

  public createGraph() {
    const indexer = new IntentIndexer();

    // --- NODE DEFINITIONS ---

    const prepNode = async (state: typeof IndexGraphState.State) => {
      logger.info("Loading intent and index context", {
        intentId: state.intentId,
        indexId: state.indexId,
      });

      const intent = await this.database.getIntentForIndexing(state.intentId);
      if (!intent) {
        logger.warn("Intent not found", { intentId: state.intentId });
        return {
          intent: null,
          indexContext: null,
          isCurrentlyAssigned: false,
          skipEvaluation: false,
          error: "Intent not found",
        };
      }

      const indexContext = await this.database.getIndexMemberContext(
        state.indexId,
        intent.userId
      );
      if (!indexContext) {
        logger.warn("Index context not found (not member or autoAssign false)", {
          indexId: state.indexId,
          userId: intent.userId,
        });
        return {
          intent: intent as IntentForIndexing,
          indexContext: null,
          isCurrentlyAssigned: false,
          skipEvaluation: false,
          error: "Index context not found",
        };
      }

      const isCurrentlyAssigned = await this.database.isIntentAssignedToIndex(
        state.intentId,
        state.indexId
      );
      const hasNoPrompts =
        !indexContext.indexPrompt?.trim() && !indexContext.memberPrompt?.trim();
      const skipEvaluation = hasNoPrompts;

      logger.info("Context loaded", {
        hasIntent: true,
        hasIndexContext: true,
        isCurrentlyAssigned,
        skipEvaluation,
      });

      return {
        intent: intent as IntentForIndexing,
        indexContext: indexContext as IndexMemberContext,
        isCurrentlyAssigned,
        skipEvaluation,
        error: null,
      };
    };

    const evaluateNode = async (state: typeof IndexGraphState.State) => {
      if (state.error) {
        logger.info("Skipping evaluation (error from prep)", {
          error: state.error,
        });
        return {};
      }

      if (state.skipEvaluation) {
        logger.info("No prompts – auto-assign");
        return {
          evaluation: null,
          shouldAssign: true,
          finalScore: 1.0,
        };
      }

      if (!state.intent || !state.indexContext) {
        return {};
      }

      logger.info("Calling IntentIndexer", {
        intentId: state.intentId,
        indexId: state.indexId,
      });

      const sourceName = state.intent.sourceType
        ? `${state.intent.sourceType}:${state.intent.sourceId ?? ""}`
        : undefined;

      const result = await indexer.evaluate(
        state.intent.payload,
        state.indexContext.indexPrompt,
        state.indexContext.memberPrompt,
        sourceName
      );

      if (!result) {
        logger.warn("IntentIndexer returned null");
        return {
          evaluation: null,
          shouldAssign: false,
          finalScore: 0,
        };
      }

      const { indexScore, memberScore } = result;
      const ip = state.indexContext.indexPrompt?.trim();
      const mp = state.indexContext.memberPrompt?.trim();

      let shouldAssign = false;
      let finalScore = 0;

      if (ip && mp) {
        if (
          indexScore > QUALIFICATION_THRESHOLD &&
          memberScore > QUALIFICATION_THRESHOLD
        ) {
          shouldAssign = true;
          finalScore = indexScore * 0.6 + memberScore * 0.4;
        }
      } else if (ip) {
        if (indexScore > QUALIFICATION_THRESHOLD) {
          shouldAssign = true;
          finalScore = indexScore;
        }
      } else if (mp) {
        if (memberScore > QUALIFICATION_THRESHOLD) {
          shouldAssign = true;
          finalScore = memberScore;
        }
      } else {
        shouldAssign = true;
        finalScore = 1.0;
      }

      logger.info("Evaluation complete", {
        indexScore,
        memberScore,
        finalScore,
        shouldAssign,
      });

      return {
        evaluation: result,
        shouldAssign,
        finalScore,
      };
    };

    const executeNode = async (state: typeof IndexGraphState.State) => {
      if (state.error) {
        logger.info("Skipping execution (error)", { error: state.error });
        return {
          assignmentResult: {
            indexId: state.indexId,
            assigned: false,
            success: false,
            error: state.error,
          } as AssignmentResult,
        };
      }

      const shouldAssign = state.shouldAssign;
      const isCurrentlyAssigned = state.isCurrentlyAssigned;

      if (shouldAssign && !isCurrentlyAssigned) {
        try {
          await this.database.assignIntentToIndex(state.intentId, state.indexId);
          logger.info("Assigned intent to index", {
            intentId: state.intentId,
            indexId: state.indexId,
            finalScore: state.finalScore,
          });
          return {
            assignmentResult: {
              indexId: state.indexId,
              assigned: true,
              success: true,
            } as AssignmentResult,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("Assign failed", { error: err });
          return {
            assignmentResult: {
              indexId: state.indexId,
              assigned: false,
              success: false,
              error: message,
            } as AssignmentResult,
          };
        }
      }

      if (!shouldAssign && isCurrentlyAssigned) {
        try {
          await this.database.unassignIntentFromIndex(state.intentId, state.indexId);
          logger.info("Unassigned intent from index", {
            intentId: state.intentId,
            indexId: state.indexId,
            finalScore: state.finalScore,
          });
          return {
            assignmentResult: {
              indexId: state.indexId,
              assigned: false,
              success: true,
            } as AssignmentResult,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("Unassign failed", { error: err });
          return {
            assignmentResult: {
              indexId: state.indexId,
              assigned: true, // was assigned, unassign failed
              success: false,
              error: message,
            } as AssignmentResult,
          };
        }
      }

      // No change
      return {
        assignmentResult: {
          indexId: state.indexId,
          assigned: isCurrentlyAssigned,
          success: true,
        } as AssignmentResult,
      };
    };

    // --- GRAPH ASSEMBLY ---

    const workflow = new StateGraph(IndexGraphState)
      .addNode("prep", prepNode)
      .addNode("evaluate", evaluateNode)
      .addNode("execute", executeNode)
      .addEdge(START, "prep")
      .addEdge("prep", "evaluate")
      .addEdge("evaluate", "execute")
      .addEdge("execute", END);

    return workflow.compile();
  }
}
