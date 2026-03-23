import { StateGraph } from "@langchain/langgraph";

import { NegotiationGraphState, type NegotiationTurn, type NegotiationOutcome, type UserNegotiationContext } from "../states/negotiation.state";

interface ConversationServiceLike {
  createConversation(participants: { participantId: string; participantType: "user" | "agent" }[]): Promise<{ id: string }>;
  sendMessage(
    conversationId: string,
    senderId: string,
    role: "user" | "agent",
    parts: unknown[],
    opts?: { taskId?: string; metadata?: Record<string, unknown> },
  ): Promise<{ id: string; senderId: string; role: string; parts: unknown[]; createdAt: Date }>;
}

interface TaskServiceLike {
  createTask(conversationId: string, metadata?: Record<string, unknown>): Promise<{ id: string; conversationId: string; state: string }>;
  updateState(taskId: string, state: string, statusMessage?: unknown): Promise<unknown>;
  createArtifact(taskId: string, data: { name?: string; parts: unknown[]; metadata?: Record<string, unknown> }): Promise<{ id: string }>;
}

interface ProposerLike {
  invoke(input: {
    ownUser: any;
    otherUser: any;
    indexContext: any;
    seedAssessment: any;
    history: NegotiationTurn[];
  }): Promise<NegotiationTurn>;
}

interface ResponderLike {
  invoke(input: {
    ownUser: any;
    otherUser: any;
    indexContext: any;
    seedAssessment: any;
    history: NegotiationTurn[];
  }): Promise<NegotiationTurn>;
}

/**
 * Factory for the bilateral negotiation LangGraph state machine.
 * @remarks Accepts dependencies via constructor for testability.
 */
export class NegotiationGraphFactory {
  constructor(
    private conversationService: ConversationServiceLike,
    private taskService: TaskServiceLike,
    private proposer: ProposerLike,
    private responder: ResponderLike,
  ) {}

  createGraph() {
    const { conversationService, taskService, proposer, responder } = this;

    const initNode = async (state: typeof NegotiationGraphState.State) => {
      try {
        const conversation = await conversationService.createConversation([
          { participantId: `agent:${state.sourceUser.id}`, participantType: "agent" },
          { participantId: `agent:${state.candidateUser.id}`, participantType: "agent" },
        ]);

        const task = await taskService.createTask(conversation.id, {
          type: "negotiation",
          sourceUserId: state.sourceUser.id,
          candidateUserId: state.candidateUser.id,
        });

        return {
          conversationId: conversation.id,
          taskId: task.id,
          currentSpeaker: "source" as const,
          turnCount: 0,
        };
      } catch (err) {
        return { error: `Init failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    };

    const turnNode = async (state: typeof NegotiationGraphState.State) => {
      try {
        const history: NegotiationTurn[] = state.messages.map((m) => {
          const dataPart = (m.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === "data");
          return dataPart?.data as NegotiationTurn;
        }).filter(Boolean);

        const isSource = state.currentSpeaker === "source";
        const agent = isSource ? proposer : responder;
        const ownUser = isSource ? state.sourceUser : state.candidateUser;
        const otherUser = isSource ? state.candidateUser : state.sourceUser;
        const senderId = `agent:${ownUser.id}`;

        const turn = await agent.invoke({
          ownUser,
          otherUser,
          indexContext: state.indexContext,
          seedAssessment: state.seedAssessment,
          history,
        });

        // First turn must be "propose"
        if (state.turnCount === 0 && turn.action !== "propose") {
          turn.action = "propose";
        }

        const parts = [{ kind: "data" as const, data: turn }];
        const message = await conversationService.sendMessage(
          state.conversationId,
          senderId,
          "agent",
          parts,
          { taskId: state.taskId },
        );

        const taskState = state.turnCount === 0 ? "working" : "input_required";
        await taskService.updateState(state.taskId, taskState);

        return {
          messages: [{
            id: message.id,
            senderId: message.senderId,
            role: "agent" as const,
            parts: message.parts,
            createdAt: message.createdAt,
          }],
          turnCount: state.turnCount + 1,
          currentSpeaker: (isSource ? "candidate" : "source") as "source" | "candidate",
          lastTurn: turn,
        };
      } catch (err) {
        return {
          lastTurn: {
            action: "reject" as const,
            assessment: { fitScore: 0, reasoning: `Agent error: ${err instanceof Error ? err.message : String(err)}`, suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
          },
          turnCount: state.turnCount + 1,
          error: `Turn failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    };

    const evaluateNode = (state: typeof NegotiationGraphState.State): string => {
      if (state.error) return "finalize";
      if (!state.lastTurn) return "finalize";
      if (state.lastTurn.action === "accept") return "finalize";
      if (state.lastTurn.action === "reject") return "finalize";
      if (state.turnCount >= state.maxTurns) return "finalize";
      return "turn";
    };

    const finalizeNode = async (state: typeof NegotiationGraphState.State) => {
      const history: NegotiationTurn[] = state.messages.map((m) => {
        const dataPart = (m.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === "data");
        return dataPart?.data as NegotiationTurn;
      }).filter(Boolean);

      const lastTurn = state.lastTurn;
      const consensus = lastTurn?.action === "accept";
      const atCap = state.turnCount >= state.maxTurns && lastTurn?.action === "counter";

      const scores = history.map((t) => t.assessment.fitScore);
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

      let agreedRoles: Array<{ userId: string; role: string }> = [];
      if (consensus && history.length >= 2) {
        const lastTwo = history.slice(-2);
        agreedRoles = [
          { userId: state.sourceUser.id, role: lastTwo[0].assessment.suggestedRoles.ownUser },
          { userId: state.candidateUser.id, role: lastTwo[1].assessment.suggestedRoles.ownUser },
        ];
      }

      const outcome: NegotiationOutcome = {
        consensus,
        finalScore: consensus ? avgScore : 0,
        agreedRoles,
        reasoning: history.map((t) => t.assessment.reasoning).join(" | "),
        turnCount: state.turnCount,
        ...(atCap && { reason: "turn_cap" }),
      };

      try {
        await taskService.updateState(state.taskId, "completed");
        await taskService.createArtifact(state.taskId, {
          name: "negotiation-outcome",
          parts: [{ kind: "data", data: outcome }],
          metadata: { consensus, turnCount: state.turnCount },
        });
      } catch (err) {
        // DB failure is non-blocking
      }

      return { outcome };
    };

    const workflow = new StateGraph(NegotiationGraphState)
      .addNode("init", initNode)
      .addNode("turn", turnNode)
      .addNode("finalize", finalizeNode)
      .addConditionalEdges("turn", evaluateNode, {
        turn: "turn",
        finalize: "finalize",
      })
      .addEdge("__start__", "init")
      .addEdge("init", "turn")
      .addEdge("finalize", "__end__");

    return workflow.compile();
  }
}

interface NegotiationCandidate {
  userId: string;
  score: number;
  reasoning: string;
  valencyRole: string;
  candidateUser: UserNegotiationContext;
}

interface NegotiationResult {
  userId: string;
  negotiationScore: number;
  agreedRoles: Array<{ userId: string; role: string }>;
  reasoning: string;
  turnCount: number;
}

/**
 * Runs bilateral negotiation for each candidate in parallel.
 * Returns only candidates that achieved consensus.
 */
export async function negotiateCandidates(
  negotiationGraph: { invoke: (input: any) => Promise<{ outcome: any }> },
  sourceUser: UserNegotiationContext,
  candidates: NegotiationCandidate[],
  indexContext: { indexId: string; prompt: string },
  maxTurns?: number,
): Promise<NegotiationResult[]> {
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const result = await negotiationGraph.invoke({
          sourceUser,
          candidateUser: candidate.candidateUser,
          indexContext,
          seedAssessment: {
            score: candidate.score,
            reasoning: candidate.reasoning,
            valencyRole: candidate.valencyRole,
          },
          ...(maxTurns !== undefined && { maxTurns }),
        });

        if (result.outcome?.consensus) {
          return {
            userId: candidate.userId,
            negotiationScore: result.outcome.finalScore,
            agreedRoles: result.outcome.agreedRoles,
            reasoning: result.outcome.reasoning,
            turnCount: result.outcome.turnCount,
          };
        }
        return null;
      } catch {
        return null;
      }
    }),
  );

  return results.filter((r): r is NegotiationResult => r !== null);
}
