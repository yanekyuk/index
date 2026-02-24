# Consent-Based Intent Creation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make intent creation in chat consent-based by showing a proposal widget (like opportunity cards) that users must approve before intents are persisted.

**Architecture:** The `create_intent` chat tool stops before DB persistence — runs inference + verification, then returns a code-fence proposal. Frontend parses and renders an `IntentProposalCard`. User clicks "Create" → calls `POST /intents/confirm` → full intent graph runs. "Skip" → calls `POST /intents/reject`.

**Tech Stack:** Bun/Express (protocol), React/Next.js (frontend), Drizzle ORM, LangGraph, Zod, Tailwind CSS

---

## Task 1: Add `propose` operation mode to Intent Graph

The intent graph needs a new mode that runs inference + verification but stops before reconciliation/executor. This way `create_intent` can get verified intent data without persisting.

**Files:**
- Modify: `protocol/src/lib/protocol/states/intent.state.ts:77` (add `'propose'` to operationMode union)
- Modify: `protocol/src/lib/protocol/graphs/intent.graph.ts:684-710` (add routing for propose mode)

**Step 1: Add `propose` to the operation mode type**

In `protocol/src/lib/protocol/states/intent.state.ts`, line 77, add `'propose'` to the union:

```typescript
operationMode: Annotation<'create' | 'update' | 'delete' | 'read' | 'propose'>({
```

**Step 2: Add propose routing in the graph**

In `protocol/src/lib/protocol/graphs/intent.graph.ts`, update `afterPrepRoute` (line 684) to handle `'propose'` the same as `'create'` (it runs inference):

```typescript
const afterPrepRoute = (state: typeof IntentGraphState.State): string => {
  if (state.error) {
    logger.warn('Prep failed with error, short-circuiting to END', { error: state.error });
    return '__end__';
  }
  if (state.operationMode === 'read') {
    logger.info('Read mode - routing to query (fast path)');
    return 'query';
  }
  return shouldRunInference(state);
};
```

No change needed here — `propose` falls through to `shouldRunInference`, which routes to `'inference'`.

Add a conditional after verification to exit early for `propose` mode. After the existing `shouldRunVerification` function (~line 718), the verification node goes to reconciler via edge. We need a conditional edge instead:

Replace the edge `.addEdge("verification", "reconciler")` (line 774) with:

```typescript
.addConditionalEdges("verification", (state: typeof IntentGraphState.State) => {
  if (state.operationMode === 'propose') {
    logger.info('Propose mode - stopping after verification, skipping reconciliation');
    return '__end__';
  }
  return 'reconciler';
}, {
  reconciler: "reconciler",
  __end__: END,
})
```

**Step 3: Run tests to verify propose mode doesn't break existing flows**

Run: `cd protocol && bun test tests/` (any existing intent graph tests)

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/states/intent.state.ts protocol/src/lib/protocol/graphs/intent.graph.ts
git commit -m "feat: add propose operation mode to intent graph

Stops after verification without running reconciliation/executor.
Used by consent-based intent creation in chat."
```

---

## Task 2: Modify `create_intent` tool to return proposal code fence

The tool stops calling the full graph and instead calls with `operationMode: 'propose'`, then formats the verified intents as `intent_proposal` code fences.

**Files:**
- Modify: `protocol/src/lib/protocol/tools/intent.tools.ts:123-208` (rewrite `createIntent` handler)

**Step 1: Rewrite the `createIntent` handler**

Replace the handler body (lines 131-207) with:

```typescript
handler: async ({ context, query }) => {
  const scopeErr = await ensureScopedMembership(context, deps.systemDb);
  if (scopeErr) return error(scopeErr);
  if (!query.description?.trim()) {
    return error("Description is required.");
  }

  // Strict scope enforcement
  if (context.indexId && query.indexId?.trim() && query.indexId.trim() !== context.indexId) {
    return error(
      `This chat is scoped to ${context.indexName ?? 'this index'}. You can only create intents in this community.`
    );
  }

  const effectiveIndexId = context.indexId || query.indexId?.trim() || undefined;

  // Fetch profile (the intent graph needs it for inference)
  const profileResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
  const userProfile = profileResult.profile ? JSON.stringify(profileResult.profile) : "";

  // Run inference + verification only (propose mode — no DB persistence)
  const result = await graphs.intent.invoke({
    userId: context.userId,
    userProfile,
    inputContent: query.description,
    operationMode: 'propose' as const,
    ...(effectiveIndexId ? { indexId: effectiveIndexId } : {}),
  });
  logger.debug("Intent graph propose response", { result });

  const verified = result.verifiedIntents || [];
  if (verified.length === 0) {
    return error("Could not extract a clear intent. Try being more specific.");
  }

  // Build intent_proposal code fences for each verified intent
  const proposalBlocks = verified.map((v: {
    description: string;
    score?: number;
    verification?: { classification?: string; semantic_entropy?: number };
  }) => {
    const proposalId = crypto.randomUUID();
    const data = {
      proposalId,
      description: v.description,
      ...(effectiveIndexId ? { indexId: effectiveIndexId } : {}),
      confidence: v.score ? Math.round((v.score / 100) * 100) / 100 : null,
      speechActType: v.verification?.classification ?? null,
    };
    return (
      "```intent_proposal\n" +
      JSON.stringify(data) +
      "\n```"
    );
  });

  const blocksText = proposalBlocks.join("\n\n");

  return success({
    proposed: true,
    count: verified.length,
    message: `IMPORTANT: Include the following \`\`\`intent_proposal code blocks EXACTLY as-is in your response (they render as interactive cards for the user to approve or skip):\n\n${blocksText}`,
  });
},
```

**Step 2: Update the tool description**

Change the description (line 126) from:

```typescript
"Creates a new intent (what the user is looking for). Pass a clear, concept-based description. If indexId is provided, the intent is linked to that index. Background discovery is triggered automatically after creation. The orchestrator should handle URL scraping and vagueness checks BEFORE calling this tool.",
```

To:

```typescript
"Proposes a new intent for the user to approve. Returns a proposal widget (intent_proposal code block) that you MUST include verbatim in your response. The user will see an interactive card and can approve or skip. Pass a clear, concept-based description. The orchestrator should handle URL scraping and vagueness checks BEFORE calling this tool.",
```

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/tools/intent.tools.ts
git commit -m "feat: create_intent tool returns proposal code fence instead of persisting

Tool now runs inference+verification only (propose mode) and returns
intent_proposal code blocks for the frontend to render as interactive
consent cards."
```

---

## Task 3: Add `POST /intents/confirm` and `POST /intents/reject` endpoints

**Files:**
- Modify: `protocol/src/controllers/intent.controller.ts` (add two new endpoints)

**Step 1: Add the confirm endpoint**

Add after the existing `process` method (after line 100):

```typescript
/**
 * Confirm a proposed intent — runs the full intent graph to persist.
 */
@Post('/confirm')
@UseGuards(AuthGuard)
async confirm(req: Request, user: AuthenticatedUser) {
  const body = await req.json().catch(() => ({})) as {
    proposalId?: string;
    description?: string;
    indexId?: string;
  };

  if (!body.description?.trim()) {
    return Response.json({ error: 'Description is required' }, { status: 400 });
  }

  logger.info('Intent confirm requested', { userId: user.id, proposalId: body.proposalId });

  const userWithGraph = await userService.findWithGraph(user.id);
  const userProfile = userWithGraph?.profile ? JSON.stringify(userWithGraph.profile) : '{}';
  const result = await intentService.processIntent(user.id, userProfile, body.description);

  // Extract created intent IDs from execution results
  const created = ((result.executionResults as Array<{ actionType: string; success: boolean; intentId?: string; payload?: string }>) || [])
    .filter(r => r.actionType === 'create' && r.success && r.intentId)
    .map(r => ({ id: r.intentId, description: r.payload }));

  // If indexId provided, link intents to index
  if (created.length > 0 && body.indexId) {
    const { IntentIndexGraphFactory } = await import('../lib/protocol/graphs/intent-index.graph');
    const intentIndexFactory = new IntentIndexGraphFactory(
      intentService['db'] as any,
      intentService['embedder']
    );
    for (const intent of created) {
      try {
        const graph = intentIndexFactory.createGraph();
        await graph.invoke({
          userId: user.id,
          indexId: body.indexId,
          intentId: intent.id,
          operationMode: 'create',
          skipEvaluation: true,
        });
      } catch (e) {
        logger.warn('Index assignment failed during confirm', { intentId: intent.id, indexId: body.indexId });
      }
    }
  }

  return Response.json({
    success: true,
    proposalId: body.proposalId,
    intents: created,
  });
}

/**
 * Reject a proposed intent — logs the rejection.
 */
@Post('/reject')
@UseGuards(AuthGuard)
async reject(req: Request, user: AuthenticatedUser) {
  const body = await req.json().catch(() => ({})) as {
    proposalId?: string;
  };

  logger.info('Intent proposal rejected', { userId: user.id, proposalId: body.proposalId });

  return Response.json({ success: true, proposalId: body.proposalId });
}
```

**Step 2: Verify the import for IntentIndexGraphFactory exists**

Check that the intent-index graph can be dynamically imported. The path should be `../lib/protocol/graphs/intent-index.graph`. If it doesn't exist or has a different export name, adjust accordingly. An alternative simpler approach: just call `intentService.processIntent` which handles everything, and skip the index linking for now (the intent can be linked via the chat agent on the next turn).

**Simplified alternative for confirm** (if intent-index graph import is complex):

```typescript
@Post('/confirm')
@UseGuards(AuthGuard)
async confirm(req: Request, user: AuthenticatedUser) {
  const body = await req.json().catch(() => ({})) as {
    proposalId?: string;
    description?: string;
    indexId?: string;
  };

  if (!body.description?.trim()) {
    return Response.json({ error: 'Description is required' }, { status: 400 });
  }

  logger.info('Intent confirm requested', { userId: user.id, proposalId: body.proposalId });

  const userWithGraph = await userService.findWithGraph(user.id);
  const userProfile = userWithGraph?.profile ? JSON.stringify(userWithGraph.profile) : '{}';
  const result = await intentService.processIntent(user.id, userProfile, body.description);

  const created = ((result.executionResults as Array<{ actionType: string; success: boolean; intentId?: string; payload?: string }>) || [])
    .filter(r => r.actionType === 'create' && r.success && r.intentId)
    .map(r => ({ id: r.intentId, description: r.payload }));

  return Response.json({
    success: true,
    proposalId: body.proposalId,
    intents: created,
  });
}
```

Use this simpler version. Index linking can happen via the chat agent tool `create_intent_index` on the next turn if needed.

**Step 3: Commit**

```bash
git add protocol/src/controllers/intent.controller.ts
git commit -m "feat: add /intents/confirm and /intents/reject endpoints

POST /intents/confirm runs full intent graph to persist an approved proposal.
POST /intents/reject logs the rejection for analytics."
```

---

## Task 4: Create `IntentProposalCard` frontend component

**Files:**
- Create: `frontend/src/components/chat/IntentProposalCard.tsx`

**Step 1: Create the component**

Model after `OpportunityCardInChat.tsx` but simpler — no avatar, no narrator chip.

```tsx
"use client";

import { useState } from "react";
import { Check, Lightbulb, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IntentProposalData {
  proposalId: string;
  description: string;
  indexId?: string;
  confidence?: number | null;
  speechActType?: string | null;
}

interface IntentProposalCardProps {
  card: IntentProposalData;
  onApprove?: (proposalId: string, description: string, indexId?: string) => void | Promise<void>;
  onReject?: (proposalId: string) => void | Promise<void>;
  isLoading?: boolean;
  currentStatus?: "pending" | "created" | "rejected";
}

export function IntentProposalSkeleton() {
  return (
    <div className="bg-[#F8F8F8] rounded-md p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 bg-gray-200 rounded-sm" />
        <div className="h-4 w-28 bg-gray-200 rounded-sm" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full bg-gray-200 rounded-sm" />
        <div className="h-4 w-[60%] bg-gray-200 rounded-sm" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <div className="h-7 w-28 bg-gray-200 rounded-sm" />
        <div className="h-7 w-14 bg-gray-200 rounded-sm" />
      </div>
    </div>
  );
}

export default function IntentProposalCard({
  card,
  onApprove,
  onReject,
  isLoading = false,
  currentStatus,
}: IntentProposalCardProps) {
  const [actionTaken, setActionTaken] = useState<"created" | "rejected" | null>(null);
  const [actionError, setActionError] = useState(false);

  const effectiveStatus = currentStatus ?? (actionTaken ? actionTaken : "pending");
  const canTakeAction = effectiveStatus === "pending";

  const handleApprove = async () => {
    if (onApprove) {
      setActionError(false);
      try {
        await onApprove(card.proposalId, card.description, card.indexId);
        setActionTaken("created");
      } catch {
        setActionError(true);
      }
    }
  };

  const handleReject = async () => {
    if (onReject) {
      setActionError(false);
      try {
        await onReject(card.proposalId);
        setActionTaken("rejected");
      } catch {
        setActionError(true);
      }
    }
  };

  if (actionError) {
    return (
      <div className="bg-gray-50 rounded-lg p-4 my-2 text-center text-sm">
        <p className="text-red-600 mb-2">Something went wrong. Please try again.</p>
        <button
          type="button"
          onClick={() => setActionError(false)}
          className="text-[#041729] font-medium hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const wrapperClass = cn(
    "rounded-md p-4",
    effectiveStatus === "rejected" ? "bg-gray-50 border border-gray-200" : "bg-[#F8F8F8]",
  );

  return (
    <div className={wrapperClass}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-xs font-semibold text-[#3D3D3D] uppercase tracking-wider">
            Proposed Intent
          </span>
        </div>
        {canTakeAction && (
          <div className="flex gap-1.5 shrink-0">
            {onApprove && (
              <button
                type="button"
                disabled={isLoading}
                className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleApprove}
              >
                {isLoading ? "Creating..." : "Create Intent"}
              </button>
            )}
            {onReject && (
              <button
                type="button"
                disabled={isLoading}
                className="bg-transparent border border-gray-400 text-[#3D3D3D] px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleReject}
              >
                Skip
              </button>
            )}
          </div>
        )}
        {effectiveStatus === "created" && (
          <span className="inline-flex items-center gap-1.5 text-green-600 text-xs font-semibold">
            <Check className="w-3.5 h-3.5 shrink-0" />
            Intent Created
          </span>
        )}
        {effectiveStatus === "rejected" && (
          <span className="inline-flex items-center gap-1 text-gray-400 text-xs font-medium">
            <X className="w-3 h-3" />
            Skipped
          </span>
        )}
      </div>

      {/* Description */}
      <p className={cn(
        "text-[14px] leading-relaxed",
        effectiveStatus === "rejected" ? "text-gray-400" : "text-[#3D3D3D]",
      )}>
        &ldquo;{card.description}&rdquo;
      </p>

      {/* Metadata */}
      {(card.confidence != null || card.speechActType) && (
        <div className={cn(
          "mt-2 flex items-center gap-2 text-xs",
          effectiveStatus === "rejected" ? "text-gray-300" : "text-gray-400",
        )}>
          {card.confidence != null && (
            <span>Confidence: {Math.round(card.confidence * 100)}%</span>
          )}
          {card.confidence != null && card.speechActType && <span>&middot;</span>}
          {card.speechActType && (
            <span>{card.speechActType.charAt(0) + card.speechActType.slice(1).toLowerCase()}</span>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/chat/IntentProposalCard.tsx
git commit -m "feat: add IntentProposalCard component

Interactive widget for consent-based intent creation in chat.
Shows description, confidence, approve/reject buttons with
in-place status transitions."
```

---

## Task 5: Add intent proposal parsing to ChatContent

**Files:**
- Modify: `frontend/src/components/ChatContent.tsx`

**Step 1: Add imports**

At the top of the file, add alongside the OpportunityCard import (line 26-29):

```typescript
import IntentProposalCard, {
  type IntentProposalData,
  IntentProposalSkeleton,
} from "@/components/chat/IntentProposalCard";
```

**Step 2: Extend the `MessageSegment` type**

At line 84-87, add intent_proposal variants:

```typescript
type MessageSegment =
  | { type: "text"; content: string }
  | { type: "opportunity"; data: OpportunityCardData }
  | { type: "opportunity_loading" }
  | { type: "intent_proposal"; data: IntentProposalData }
  | { type: "intent_proposal_loading" };
```

**Step 3: Create `parseIntentProposalBlocks` function**

Add after `parseOpportunityBlocks` (after line 148):

```typescript
function parseIntentProposalBlocks(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const regex = /```intent_proposal\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        segments.push({ type: "text", content: textBefore });
      }
    }

    try {
      const jsonStr = match[1].trim();
      const data = JSON.parse(jsonStr) as IntentProposalData;
      if (data.proposalId && data.description) {
        segments.push({ type: "intent_proposal", data });
      } else {
        segments.push({ type: "text", content: match[0] });
      }
    } catch {
      segments.push({ type: "text", content: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  const remainingContent = content.slice(lastIndex);
  const partialStartMatch = remainingContent.match(/```intent_proposal/);

  if (partialStartMatch) {
    const partialIndex = partialStartMatch.index!;
    const textBefore = remainingContent.slice(0, partialIndex);
    if (textBefore.trim()) {
      segments.push({ type: "text", content: textBefore });
    }
    segments.push({ type: "intent_proposal_loading" });
  } else if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    if (remaining.trim()) {
      segments.push({ type: "text", content: remaining });
    }
  }

  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "text", content });
  }

  return segments;
}
```

**Step 4: Create unified `parseAllBlocks` function**

Add after the new function:

```typescript
/**
 * Parse both opportunity and intent_proposal code blocks from message content.
 * Runs both parsers and merges results preserving source order.
 */
function parseAllBlocks(content: string): MessageSegment[] {
  // Regex to match both block types and capture their positions
  const regex = /```(opportunity|intent_proposal)\s*\n([\s\S]*?)```/g;
  const segments: MessageSegment[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        segments.push({ type: "text", content: textBefore });
      }
    }

    const blockType = match[1]; // "opportunity" or "intent_proposal"
    try {
      const jsonStr = match[2].trim();
      const data = JSON.parse(jsonStr);

      if (blockType === "opportunity" && data.opportunityId && data.userId) {
        segments.push({ type: "opportunity", data: data as OpportunityCardData });
      } else if (blockType === "intent_proposal" && data.proposalId && data.description) {
        segments.push({ type: "intent_proposal", data: data as IntentProposalData });
      } else {
        segments.push({ type: "text", content: match[0] });
      }
    } catch {
      segments.push({ type: "text", content: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Check for partial blocks at end (streaming)
  const remainingContent = content.slice(lastIndex);
  const partialOpp = remainingContent.match(/```opportunity/);
  const partialIntent = remainingContent.match(/```intent_proposal/);
  const partialMatch = partialOpp || partialIntent;

  if (partialMatch) {
    const partialIndex = partialMatch.index!;
    const textBefore = remainingContent.slice(0, partialIndex);
    if (textBefore.trim()) {
      segments.push({ type: "text", content: textBefore });
    }
    segments.push(partialOpp
      ? { type: "opportunity_loading" as const }
      : { type: "intent_proposal_loading" as const }
    );
  } else if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    if (remaining.trim()) {
      segments.push({ type: "text", content: remaining });
    }
  }

  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "text", content });
  }

  return segments;
}
```

**Step 5: Update `dedupeOpportunitySegments` to also dedupe proposals**

Rename to `dedupeSegments` and extend:

```typescript
function dedupeSegments(segments: MessageSegment[]): MessageSegment[] {
  const seenOpps = new Set<string>();
  const seenProposals = new Set<string>();
  return segments.filter((seg) => {
    if (seg.type === "opportunity") {
      if (seenOpps.has(seg.data.opportunityId)) return false;
      seenOpps.add(seg.data.opportunityId);
      return true;
    }
    if (seg.type === "intent_proposal") {
      if (seenProposals.has(seg.data.proposalId)) return false;
      seenProposals.add(seg.data.proposalId);
      return true;
    }
    return true;
  });
}
```

**Step 6: Update `AssistantMessageContent` to use new parser and render proposals**

Replace the `parseOpportunityBlocks` call (line 205-207) with:

```typescript
const segments = dedupeSegments(parseAllBlocks(displayedContent));
```

In the segments.map render loop, add the `intent_proposal` cases after the `opportunity` case (after line 244):

```typescript
} else if (segment.type === "intent_proposal") {
  return (
    <div key={segment.data.proposalId} className="my-3">
      <IntentProposalCard
        card={segment.data}
        onApprove={onIntentProposalApprove}
        onReject={onIntentProposalReject}
        isLoading={intentProposalLoadingMap?.[segment.data.proposalId] ?? false}
        currentStatus={intentProposalStatusMap?.[segment.data.proposalId]}
      />
    </div>
  );
} else if (segment.type === "intent_proposal_loading") {
  return (
    <div key={`intent-loading-${idx}`} className="my-3">
      <IntentProposalSkeleton />
    </div>
  );
```

**Step 7: Add intent proposal props to `AssistantMessageContent`**

Extend the component's props interface to include:

```typescript
onIntentProposalApprove?: (proposalId: string, description: string, indexId?: string) => void;
onIntentProposalReject?: (proposalId: string) => void;
intentProposalLoadingMap?: Record<string, boolean>;
intentProposalStatusMap?: Record<string, "pending" | "created" | "rejected">;
```

**Step 8: Commit**

```bash
git add frontend/src/components/ChatContent.tsx
git commit -m "feat: parse and render intent_proposal code blocks in chat

Extends ChatContent to parse intent_proposal code fences alongside
opportunity blocks, with deduplication and streaming skeleton support."
```

---

## Task 6: Wire up intent proposal actions in ChatContent

**Files:**
- Modify: `frontend/src/components/ChatContent.tsx` (main component — state + handlers)

**Step 1: Add state for intent proposal tracking**

In the `ChatContent` component, after the opportunity status/loading state (around line 312-366), add:

```typescript
// Intent proposal status tracking
const [intentProposalStatusMap, setIntentProposalStatusMap] = useState<
  Record<string, "pending" | "created" | "rejected">
>({});
const [intentProposalLoadingMap, setIntentProposalLoadingMap] = useState<
  Record<string, boolean>
>({});
```

**Step 2: Add approve/reject handlers**

After `handleHomeOpportunityAction` (around line 540), add:

```typescript
const handleIntentProposalApprove = useCallback(
  async (proposalId: string, description: string, indexId?: string) => {
    setIntentProposalLoadingMap((prev) => ({ ...prev, [proposalId]: true }));
    try {
      await apiClient.post("/intents/confirm", { proposalId, description, indexId });
      setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "created" }));
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to create intent");
      throw err; // Re-throw so card shows error state
    } finally {
      setIntentProposalLoadingMap((prev) => ({ ...prev, [proposalId]: false }));
    }
  },
  [showError],
);

const handleIntentProposalReject = useCallback(
  async (proposalId: string) => {
    setIntentProposalLoadingMap((prev) => ({ ...prev, [proposalId]: true }));
    try {
      await apiClient.post("/intents/reject", { proposalId });
      setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "rejected" }));
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to dismiss proposal");
      throw err;
    } finally {
      setIntentProposalLoadingMap((prev) => ({ ...prev, [proposalId]: false }));
    }
  },
  [showError],
);
```

**Step 3: Pass the new props through to `AssistantMessageContent`**

In both places where `<AssistantMessageContent>` is rendered (the conversation mode ~line 1315), add:

```typescript
onIntentProposalApprove={handleIntentProposalApprove}
onIntentProposalReject={handleIntentProposalReject}
intentProposalLoadingMap={intentProposalLoadingMap}
intentProposalStatusMap={intentProposalStatusMap}
```

**Step 4: Commit**

```bash
git add frontend/src/components/ChatContent.tsx
git commit -m "feat: wire up intent proposal approve/reject actions

Adds state tracking and API handlers for intent proposal cards.
Approve calls POST /intents/confirm, reject calls POST /intents/reject."
```

---

## Task 7: Update agent system prompt

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.ts`

**Step 1: Update the Tools Reference table**

In the tools table (around line 225), change the `create_intent` row from:

```
| **create_intent** | description, indexId? | Persist an intent. Just stores it. |
```

To:

```
| **create_intent** | description, indexId? | Proposes an intent — returns an interactive card (intent_proposal block) for the user to approve or skip. Does NOT persist until the user clicks "Create Intent". |
```

**Step 2: Update Orchestration Pattern 2 (user wants to create an intent)**

Replace section "### 2. User explicitly wants to create or save an intent" (lines 249-268) with:

```
### 2. User explicitly wants to create or save an intent

**YOU decide if it's specific enough. The tool proposes — the user confirms.**

\`\`\`
IF description is vague ("find a job", "meet people", "learn something"):
  1. read_user_profiles()           → get their background
  2. read_intents()                 → see existing intents for context
  3. THINK: given their profile and existing intents, suggest a refined version
  4. Reply: "Based on your background in X, did you mean something like 'Y'?"
  5. Wait for confirmation
  6. On "yes" → create_intent(description=exact_refined_text)

IF description is specific enough ("contribute to an open-source LLM project"):
  → create_intent(description=...) directly
\`\`\`

**CRITICAL: create_intent returns an \`\`\`intent_proposal code block. You MUST include it verbatim in your response — it renders as an interactive card.** Add a brief explanation that creating this intent will let the system look for relevant people in the background. The user can approve, skip, or ask you to refine the description first.
```

**Step 3: Update the opportunity card output rule**

In "### Output Format" (around line 427), after the existing opportunity card rule, add:

```
- **Intent proposal cards**: When a tool returns \`\`\`intent_proposal code blocks, you MUST include them exactly as-is in your response. These blocks are rendered as interactive cards in the UI. Add a brief note explaining that creating this intent enables background discovery of relevant people.
```

**Step 4: Update onboarding Step 6**

In the onboarding flow (around line 134-137), change:

```
6. **Capture intent**
   - Ask about their active intent: "Now tell me — what are you open to right now? Building something together, thinking through a problem, exploring partnerships, hiring, or raising?"
   - When they respond → call \`create_intent(description="...")\`
```

To:

```
6. **Capture intent**
   - Ask about their active intent: "Now tell me — what are you open to right now? Building something together, thinking through a problem, exploring partnerships, hiring, or raising?"
   - When they respond → call \`create_intent(description="...")\` — this returns a proposal card
   - Include the \`\`\`intent_proposal block verbatim and explain: "I've drafted this as a priority for you. Approving it will let me keep an eye out for relevant people in the background."
```

**Step 5: Update wrap-up step**

Change Step 7 wrap-up (line 140) closing from:

```
- Close with: "You're all set. I've started looking for relevant people — check your home page for new matches."
```

To:

```
- Close with: "You're all set. Once you approve the priority above, I'll start looking for relevant people — check your home page for new matches."
```

**Step 6: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.ts
git commit -m "feat: update chat agent prompt for consent-based intent creation

Agent now knows create_intent returns proposal widgets, must include
them verbatim, and should explain background discovery benefits."
```

---

## Task 8: Manual smoke test

**Step 1: Start the protocol dev server**

Run: `cd protocol && bun run dev`

**Step 2: Start the frontend dev server**

Run: `cd frontend && bun run dev`

**Step 3: Test the chat flow**

1. Open the app, start a new chat
2. Say: "I'm looking for a React Native engineer"
3. Verify the agent returns a message with an intent proposal card widget
4. Click "Create Intent" — verify the card updates to "Intent Created"
5. Send a follow-up message — verify the agent acknowledges the new intent
6. Start another chat, describe an intent, click "Skip" — verify the card shows "Skipped"

**Step 4: Test edge cases**

1. Vague intent ("find a job") — agent should refine before proposing
2. Multiple intents in one message — each gets its own card
3. Reload the page with a saved session — cards should render from saved messages (status defaults to pending for historical proposals)

---

## Task 9: Final commit and branch cleanup

**Step 1: Run lint**

Run: `cd protocol && bun run lint`
Run: `cd frontend && bun run lint`

Fix any lint issues.

**Step 2: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: lint and cleanup for consent-based intent creation"
```

**Step 3: Use finishing-a-development-branch skill**

Invoke `superpowers:finishing-a-development-branch` to decide on merge/PR strategy.
