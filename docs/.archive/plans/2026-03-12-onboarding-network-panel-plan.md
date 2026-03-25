# Onboarding Network Panel — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a reusable `networks_panel` block type — identical in both the onboarding and main chat — that the agent emits whenever it wants to show the network join UI. The panel fetches and renders public networks (Discover + Joined sections) inline in any chat conversation.

**Architecture:** The agent emits ` ```networks_panel\n{}\n``` ` as a marker block. `parseAllBlocks` (shared logic in both `ChatContent.tsx` and `onboarding/page.tsx`) parses it into a `networks_panel` segment. A new `NetworksPanel` chat component renders inline wherever the block appears. Clicking Join sends a chat message to the agent. The system prompt is updated to emit this block during onboarding step 6 and any future community discovery context.

**Tech Stack:** React, TypeScript, `IndexAvatar`, Lucide icons, `useIndexes` (APIContext), `useIndexesState` (IndexesContext)

---

### Task 1: Create `NetworksPanel` component

**Files:**
- Create: `frontend/src/components/chat/NetworksPanel.tsx`

**Step 1: Write the component**

```tsx
import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";
import IndexAvatar from "@/components/IndexAvatar";
import { Button } from "@/components/ui/button";
import { useIndexes } from "@/contexts/APIContext";
import { useIndexesState } from "@/contexts/IndexesContext";
import type { Index } from "@/lib/types";

interface NetworksPanelProps {
  onJoin: (networkId: string, networkTitle: string) => void;
  pendingJoinIds?: Set<string>;
}

/**
 * Inline network join panel rendered by the agent's networks_panel block.
 * Shows already-joined networks with a badge and public networks with a Join button.
 */
export default function NetworksPanel({ onJoin, pendingJoinIds = new Set() }: NetworksPanelProps) {
  const indexesService = useIndexes();
  const { indexes: joinedIndexes } = useIndexesState();

  const [publicNetworks, setPublicNetworks] = useState<(Index & { isMember?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    indexesService
      .discoverPublicIndexes(1, 50)
      .then((res) => setPublicNetworks(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [indexesService]);

  const joinedIds = new Set(joinedIndexes.filter((i) => !i.isPersonal).map((i) => i.id));
  const joined = publicNetworks.filter((n) => joinedIds.has(n.id));
  const joinable = publicNetworks.filter((n) => !joinedIds.has(n.id));

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      </div>
    );
  }

  if (publicNetworks.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-4">No public networks available</p>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-[#E8E8E8] bg-[#FAFAFA] overflow-hidden">
      {joined.length > 0 && (
        <div>
          <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-400 font-medium">
            Joined
          </p>
          <div className="divide-y divide-gray-100">
            {joined.map((network) => (
              <div key={network.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-9 h-9 rounded-full overflow-hidden shrink-0">
                  <IndexAvatar id={network.id} title={network.title} imageUrl={network.imageUrl} size={36} rounded="full" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-black truncate">{network.title}</p>
                  <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                    <Users className="w-3 h-3" />
                    {network._count?.members ?? 0} members
                  </p>
                </div>
                <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-sm font-medium flex-shrink-0">
                  Joined
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {joinable.length > 0 && (
        <div>
          {joined.length > 0 && <div className="border-t border-gray-100" />}
          <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-400 font-medium">
            Discover
          </p>
          <div className="divide-y divide-gray-100">
            {joinable.map((network) => {
              const isPending = pendingJoinIds.has(network.id);
              return (
                <div key={network.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-9 h-9 rounded-full overflow-hidden shrink-0">
                    <IndexAvatar id={network.id} title={network.title} imageUrl={network.imageUrl} size={36} rounded="full" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-black truncate">{network.title}</p>
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                      <Users className="w-3 h-3" />
                      {network._count?.members ?? 0} members
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onJoin(network.id, network.title)}
                    disabled={isPending}
                    className="text-xs h-7 flex-shrink-0"
                  >
                    {isPending ? "Joining…" : "Join"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/chat/NetworksPanel.tsx
git commit -m "feat(chat): add reusable NetworksPanel component"
```

---

### Task 2: Add `networks_panel` block to `ChatContent.tsx`

**Files:**
- Modify: `frontend/src/components/ChatContent.tsx`

This file has its own copy of `MessageSegment`, `parseAllBlocks`, `dedupeSegments`, and `AssistantMessageContent`. Update all four.

**Step 1: Add import**

After the existing chat component imports (around line 34), add:

```tsx
import NetworksPanel from "@/components/chat/NetworksPanel";
```

**Step 2: Extend `MessageSegment` type (line ~88)**

Add the new variant:

```ts
type MessageSegment =
  | { type: "text"; content: string }
  | { type: "opportunity"; data: OpportunityCardData }
  | { type: "opportunity_loading" }
  | { type: "intent_proposal"; data: IntentProposalData }
  | { type: "intent_proposal_loading" }
  | { type: "networks_panel" }
  | { type: "networks_panel_loading" };
```

**Step 3: Update `parseAllBlocks` regex and handler (line ~95)**

Change the regex to include `networks_panel`:

```ts
const regex = /```(opportunity|intent_proposal|networks_panel)\s*\n([\s\S]*?)\n```/g;
```

In the `blockType` switch, after the `intent_proposal` branch, add:

```ts
} else if (blockType === "networks_panel") {
  segments.push({ type: "networks_panel" });
}
```

In the partial block detection at the bottom, add `networks_panel` to the partial match:

```ts
const partialOpp = remainingContent.match(/```opportunity/);
const partialIntent = remainingContent.match(/```intent_proposal/);
const partialNetworks = remainingContent.match(/```networks_panel/);

// Pick the earliest partial match
const candidates = [partialOpp, partialIntent, partialNetworks].filter(Boolean) as RegExpMatchArray[];
const partialMatch = candidates.length > 0
  ? candidates.reduce((earliest, c) => c.index! < earliest.index! ? c : earliest)
  : null;
```

Update the loading segment push:

```ts
if (partialMatch) {
  const partialIndex = partialMatch.index!;
  const textBefore = remainingContent.slice(0, partialIndex);
  if (textBefore.trim()) segments.push({ type: "text", content: textBefore });
  if (partialMatch === partialOpp) {
    segments.push({ type: "opportunity_loading" });
  } else if (partialMatch === partialIntent) {
    segments.push({ type: "intent_proposal_loading" });
  } else {
    segments.push({ type: "networks_panel_loading" });
  }
}
```

**Step 4: Add `onNetworkJoin` prop to `AssistantMessageContent` (line ~192)**

Add the prop to the function signature and type:

```ts
function AssistantMessageContent({
  // ... existing props ...
  onNetworkJoin,
  networkPanelPendingJoinIds,
}: {
  // ... existing prop types ...
  onNetworkJoin?: (networkId: string, networkTitle: string) => void;
  networkPanelPendingJoinIds?: Set<string>;
})
```

**Step 5: Render `NetworksPanel` in the segment map (after `intent_proposal_loading` branch)**

In the `segments.map(...)` JSX, add after the last `else` (currently `intent_proposal_loading`):

```tsx
} else if (segment.type === "networks_panel") {
  return (
    <div key={`networks-panel-${idx}`} className="my-3">
      <NetworksPanel
        onJoin={onNetworkJoin ?? (() => {})}
        pendingJoinIds={networkPanelPendingJoinIds}
      />
    </div>
  );
} else if (segment.type === "networks_panel_loading") {
  return (
    <div key={`networks-panel-loading-${idx}`} className="my-3 flex justify-center py-6">
      <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
    </div>
  );
}
```

Also add `Loader2` to the lucide-react import at the top if not already present (it's not — check line 6).

**Step 6: Add `networkPanelPendingJoinIds` state and `handleNetworkJoin` in `ChatContent` (line ~311)**

After the existing state declarations in `ChatContent`, add:

```tsx
const [networkPanelPendingJoinIds, setNetworkPanelPendingJoinIds] = useState<Set<string>>(new Set());

const handleNetworkJoin = useCallback(
  (networkId: string, networkTitle: string) => {
    setNetworkPanelPendingJoinIds((prev) => new Set([...prev, networkId]));
    sendMessage(`I'd like to join ${networkTitle}`);
  },
  [sendMessage],
);
```

**Step 7: Pass props to `AssistantMessageContent` call site (line ~1476)**

Add the two new props to the `<AssistantMessageContent>` JSX:

```tsx
onNetworkJoin={handleNetworkJoin}
networkPanelPendingJoinIds={networkPanelPendingJoinIds}
```

**Step 8: Commit**

```bash
git add frontend/src/components/ChatContent.tsx
git commit -m "feat(chat): support networks_panel block in ChatContent"
```

---

### Task 3: Add `networks_panel` block to `onboarding/page.tsx`

**Files:**
- Modify: `frontend/src/app/onboarding/page.tsx`

This file has its own duplicated `MessageSegment`, `parseAllBlocks`, `dedupeSegments`, and `AssistantMessageContent`. Apply the same changes as Task 2.

**Step 1: Add import**

```tsx
import NetworksPanel from "@/components/chat/NetworksPanel";
```

**Step 2: Extend `MessageSegment` type (line ~69)**

Same addition as Task 2:

```ts
| { type: "networks_panel" }
| { type: "networks_panel_loading" }
```

**Step 3: Update `parseAllBlocks` (line ~76)**

Same regex change and `networks_panel` handler as Task 2.

**Step 4: Add `onNetworkJoin` prop to `AssistantMessageContent` (line ~147)**

Same prop addition as Task 2.

**Step 5: Render `NetworksPanel` segment**

Same rendering logic as Task 2, including the `networks_panel_loading` case.

**Step 6: Add `networkPanelPendingJoinIds` state and `handleNetworkJoin` in `OnboardingPage` (line ~268)**

```tsx
const [networkPanelPendingJoinIds, setNetworkPanelPendingJoinIds] = useState<Set<string>>(new Set());

const handleNetworkJoin = useCallback(
  (networkId: string, networkTitle: string) => {
    setNetworkPanelPendingJoinIds((prev) => new Set([...prev, networkId]));
    sendOnboardingMessage(`I'd like to join ${networkTitle}`);
  },
  [sendOnboardingMessage],
);
```

**Step 7: Pass props to `AssistantMessageContent` call site (line ~556)**

```tsx
onNetworkJoin={handleNetworkJoin}
networkPanelPendingJoinIds={networkPanelPendingJoinIds}
```

**Step 8: Remove the `communities` step detection injection**

The `onboardingStep` detection and step-based suggestions for `communities` are no longer needed since the agent controls the panel via the block. Remove or simplify the `communities` entry from `ONBOARDING_STEP_SUGGESTIONS`:

```ts
// Remove:
communities: [
  { label: "Skip for now", type: "direct", followupText: "I'll skip for now" },
  { label: "Tell me more", type: "direct", followupText: "Tell me more about these communities" },
],
```

The agent's response after showing the networks panel will carry its own context — no extra chips needed for this step.

**Step 9: Commit**

```bash
git add frontend/src/app/onboarding/page.tsx
git commit -m "feat(onboarding): support networks_panel block"
```

---

### Task 4: Update system prompt to emit `networks_panel` block

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.ts` (lines ~132–142)

**Step 1: Update step 6 instruction**

Find the step 6 block (starts `6. **Discover communities**`) and replace it:

```
6. **Discover communities**
   - Call \`read_indexes()\` to get available public indexes (returned in \`publicIndexes\` array)
   - **Do NOT list communities in text.** The UI renders an interactive card panel automatically.
   - Output this exact block in your response (do not include any JSON data — just the empty object):
     \`\`\`networks_panel
     {}
     \`\`\`
   - Immediately after the block, say: "Here are some communities you might find relevant — pick any you'd like to join, or skip and we'll continue."
   - When presenting, avoid being vocal about 'indexes' unless the user asks.
   - For each index the user wants to join → call \`create_index_membership(indexId=X)\` (omit userId to self-join)
   - After handling the user's response (joins processed, question answered, or user skips) → ALWAYS proceed to step 7 (intent capture). Do NOT end the conversation at communities.
```

**Step 2: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.ts
git commit -m "feat(onboarding): emit networks_panel block in communities step"
```

---

### Task 5: Smoke test end-to-end

**Step 1: Reset onboarding for your test user**

```bash
cd protocol && bun src/cli/reset-onboarding.ts
```

**Step 2: Run dev and go through onboarding**

Start the dev server and navigate to `/onboarding`. Advance through the flow until the communities step. Confirm:
- [ ] The agent outputs the `networks_panel` block (no bulleted text list)
- [ ] `NetworksPanel` appears inline below the agent message
- [ ] "Joined" section shows already-joined networks with badge
- [ ] "Discover" section shows joinable networks with Join button
- [ ] Clicking "Join" shows "Joining…" and sends a chat message
- [ ] After agent processes the join, panel re-fetches on next render (networks move to Joined)
- [ ] The panel also works in regular chat (test by typing "show me communities" or similar)

**Step 3: Fix any issues and commit**

```bash
git add -A
git commit -m "fix(onboarding): network panel smoke test fixes"
```
