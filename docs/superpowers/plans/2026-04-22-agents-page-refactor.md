# Agents Page Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the `/agents` page to show Agent IDs in cards, replace the inline amber key banner with a modal containing personalized setup instructions, and move setup instructions from per-agent cards to a single page-level section.

**Architecture:** All new UI primitives (`ClickableCodeBlock`, `WizardRow`, `WizardPromptGrid`, `OpenClawSetup`) are defined as local functions within each page file (no shared component file — YAGNI). `ApiKeyCreatedModal` uses `@radix-ui/react-dialog` already present in the codebase. The existing `newlyCreatedKey` state drives the modal.

**Tech Stack:** React 19, Vite, Tailwind CSS 4, `@radix-ui/react-dialog`, lucide-react

---

## File Structure

| File | Changes |
|------|---------|
| `frontend/src/app/agents/page.tsx` | Add `ClickableCodeBlock`, `WizardRow`, `WizardPromptGrid`, `OpenClawSetup`, `ApiKeyCreatedModal`; refactor `SetupInstructions` (always-expanded); remove inline amber banner, `copiedKey`, `handleCopyKey`; add Agent ID row to cards; add page-level setup section |
| `frontend/src/app/agents/[id]/page.tsx` | Add same four UI primitives locally; refactor `SetupInstructions` to use them (keep collapsible toggle — it's inside a tab) |

---

### Task 1: Add `ClickableCodeBlock` to `page.tsx` and update imports

**Files:**
- Modify: `frontend/src/app/agents/page.tsx`

- [ ] **Step 1: Update the lucide-react import on line 3**

Remove `ChevronDown` and `ChevronRight` (only used by the old collapsible `SetupInstructions` which will be replaced). Replace:

```tsx
import { Bot, Check, ChevronDown, ChevronRight, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
```

with:

```tsx
import { Bot, Check, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
```

- [ ] **Step 2: Add `@radix-ui/react-dialog` import after line 2**

After:
```tsx
import { Link, useNavigate } from 'react-router';
```

Add:
```tsx
import * as Dialog from '@radix-ui/react-dialog';
```

- [ ] **Step 3: Replace the `CodeBlock` function (lines 46–77) with `ClickableCodeBlock`**

Remove the entire `CodeBlock` function and replace it with:

```tsx
function ClickableCodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* silent */ }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="relative w-full text-left group bg-gray-50 border border-gray-200 rounded-sm p-3 hover:bg-green-50 hover:border-green-300 transition-colors"
    >
      <span className="block text-xs text-gray-700 font-mono whitespace-pre-wrap break-all pr-16">{code}</span>
      <span className="absolute top-2 right-2 text-xs text-gray-400 group-hover:text-green-700 transition-colors select-none">
        {copied ? '✓ Copied' : '⧉ Copy'}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
cd frontend && bun run dev
```

Expected: dev server starts with no TypeScript errors in the terminal.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/agents/page.tsx
git commit -m "refactor(agents-page): replace CodeBlock with ClickableCodeBlock"
```

---

### Task 2: Add `WizardRow`, `WizardPromptGrid`, and `OpenClawSetup` to `page.tsx`

**Files:**
- Modify: `frontend/src/app/agents/page.tsx`

Insert all three functions after the closing brace of `CopyButton` (currently around line 101) and before `SetupInstructions`.

- [ ] **Step 1: Add `WizardRow` after `CopyButton`**

```tsx
function WizardRow({
  prompt,
  description,
  value,
  copyable,
}: {
  prompt: string;
  description: string;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* silent */ }
  }

  return (
    <>
      <div className="flex flex-col justify-center p-3 border-b border-r border-gray-200 bg-gray-50">
        <span className="text-xs font-medium text-gray-700">{prompt}</span>
        <span className="text-xs text-gray-400 mt-0.5">{description}</span>
      </div>
      {copyable ? (
        <button
          type="button"
          onClick={handleCopy}
          className="relative group flex items-start p-3 border-b border-gray-200 bg-gray-50 hover:bg-green-50 hover:border-green-300 transition-colors text-left font-mono text-xs text-gray-700 whitespace-pre-wrap break-all"
        >
          <span className="pr-16">{value}</span>
          <span className="absolute top-2 right-2 text-xs text-gray-400 group-hover:text-green-700 transition-colors select-none">
            {copied ? '✓ Copied' : '⧉ Copy'}
          </span>
        </button>
      ) : (
        <div className="flex items-center p-3 border-b border-gray-200 text-xs text-gray-500 italic">
          {value}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Add `WizardPromptGrid` after `WizardRow`**

```tsx
function WizardPromptGrid({
  serverUrl,
  agentId,
  apiKey,
}: {
  serverUrl: string;
  agentId: string;
  apiKey: string;
}) {
  return (
    <div className="border border-gray-200 rounded-sm overflow-hidden">
      <div className="grid grid-cols-2 border-b border-gray-200 bg-gray-100 px-3 py-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Prompt</span>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Value</span>
      </div>
      <div className="grid grid-cols-2">
        <WizardRow prompt="Server URL" description="Index Network API endpoint" value={serverUrl} copyable />
        <WizardRow prompt="Agent ID" description="Your personal agent's unique identifier" value={agentId} copyable />
        <WizardRow prompt="API Key" description="The API key you just generated" value={apiKey} copyable />
        <div className="col-span-2 px-3 py-2 border-b border-gray-200 bg-gray-100">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Optional</span>
        </div>
        <WizardRow
          prompt="Delivery channel"
          description="Platform to receive notifications (Telegram, Discord, Slack, etc.)"
          value="select or skip"
        />
        <WizardRow
          prompt="Delivery target"
          description="Your user ID or handle on the chosen platform"
          value="your ID"
        />
        <WizardRow
          prompt="Daily digest"
          description="Receive a daily summary of opportunities"
          value="enable / disable"
        />
        <WizardRow
          prompt="Digest time"
          description="Time to send the daily digest (24-hour format)"
          value="08:00 (default)"
        />
        <WizardRow
          prompt="Max per digest"
          description="Maximum number of opportunities included per digest"
          value="10 (default)"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `OpenClawSetup` after `WizardPromptGrid`**

```tsx
function OpenClawSetup({
  install,
  update,
  setup,
}: {
  install: string;
  update: string;
  setup: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-start">
        <div className="flex flex-col items-center pt-1 shrink-0">
          <div className="w-2 h-2 rounded-full bg-gray-300" />
          <div className="w-px h-4 bg-gray-200 my-1" />
          <div className="w-2 h-2 rounded-full bg-gray-300" />
        </div>
        <div className="flex-1 space-y-2">
          <div>
            <p className="text-xs text-gray-500 mb-1">Install (first time)</p>
            <ClickableCodeBlock code={install} />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Update (if already installed)</p>
            <ClickableCodeBlock code={update} />
          </div>
        </div>
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-1">Run setup wizard</p>
        <ClickableCodeBlock code={setup} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
cd frontend && bun run dev
```

Expected: dev server starts with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/agents/page.tsx
git commit -m "refactor(agents-page): add WizardRow, WizardPromptGrid, OpenClawSetup components"
```

---

### Task 3: Refactor `SetupInstructions` and add `ApiKeyCreatedModal` to `page.tsx`

**Files:**
- Modify: `frontend/src/app/agents/page.tsx`

- [ ] **Step 1: Replace the entire `SetupInstructions` function (lines 103–184) with the always-expanded version**

```tsx
function SetupInstructions({ apiKey, agentId }: { apiKey?: string; agentId?: string }) {
  const keyValue = apiKey || 'YOUR_API_KEY';
  const agentValue = agentId || 'YOUR_AGENT_ID';
  const protocolUrl = import.meta.env.VITE_PROTOCOL_URL || 'https://api.index.network';
  const mcpUrl = `${protocolUrl}/mcp`;

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        'index-network': {
          type: 'http',
          url: mcpUrl,
          headers: {
            'x-api-key': keyValue,
          },
        },
      },
    },
    null,
    2,
  );

  const hermesConfig = `mcp_servers:
  - name: index-network
    url: ${mcpUrl}
    headers:
      x-api-key: ${keyValue}`;

  const openclawInstall = `openclaw plugins install indexnetwork-openclaw-plugin --marketplace https://github.com/indexnetwork/openclaw-plugin`;
  const openclawUpdate = `openclaw plugins update indexnetwork-openclaw-plugin`;
  const openclawSetup = `openclaw index-network setup`;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Claude Code / OpenCode</p>
        <ClickableCodeBlock code={claudeConfig} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Hermes Agent</p>
        <ClickableCodeBlock code={hermesConfig} />
      </div>
      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">OpenClaw</p>
        <OpenClawSetup install={openclawInstall} update={openclawUpdate} setup={openclawSetup} />
        <WizardPromptGrid serverUrl={protocolUrl} agentId={agentValue} apiKey={keyValue} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `ApiKeyCreatedModal` directly after `SetupInstructions`**

```tsx
function ApiKeyCreatedModal({
  agentName,
  agentId,
  apiKey,
  onClose,
}: {
  agentName: string;
  agentId: string;
  apiKey: string;
  onClose: () => void;
}) {
  const [copiedKey, setCopiedKey] = useState(false);

  async function handleCopyKey() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 1500);
    } catch { /* silent */ }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-sm shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-6 focus:outline-none">
          <div>
            <Dialog.Title className="text-lg font-semibold text-gray-900">API Key Created</Dialog.Title>
            <Dialog.Description className="text-sm text-gray-500 mt-1">For: {agentName}</Dialog.Description>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-sm p-4 space-y-3">
            <p className="text-sm font-medium text-amber-800">Copy this key now — it won't be shown again</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white border border-amber-200 rounded-sm px-3 py-2 text-sm font-mono text-gray-900 break-all select-all">
                {apiKey}
              </code>
              <Button variant="outline" size="sm" onClick={handleCopyKey}>
                {copiedKey ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Your Agent ID and API key are pre-filled below. Pick the platform you use.
            </p>
            <SetupInstructions apiKey={apiKey} agentId={agentId} />
          </div>

          <div className="flex justify-end pt-2 border-t border-gray-100">
            <Button onClick={onClose}>Done</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
cd frontend && bun run dev
```

Expected: dev server starts with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/agents/page.tsx
git commit -m "refactor(agents-page): add new SetupInstructions and ApiKeyCreatedModal"
```

---

### Task 4: Wire modal + Agent ID row + page-level setup into the page layout

**Files:**
- Modify: `frontend/src/app/agents/page.tsx`

- [ ] **Step 1: Remove `copiedKey` state (line 199)**

Remove:
```tsx
const [copiedKey, setCopiedKey] = useState(false);
```

- [ ] **Step 2: Remove `handleCopyKey` function (lines 345–353)**

Remove:
```tsx
async function handleCopyKey(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  } catch {
    error('Failed to copy key');
  }
}
```

- [ ] **Step 3: Add `modalAgent` derived value after the `systemAgents` useMemo**

After:
```tsx
const systemAgents = useMemo(
  () => agents.filter((agent) => agent.type === 'system'),
  [agents],
);
```

Add:
```tsx
const modalAgent = newlyCreatedKey ? agents.find((a) => a.id === newlyCreatedKey.agentId) : null;
```

- [ ] **Step 4: Remove `createdKeyForAgent` variable and inline amber banner from personal agent cards**

Inside the `personalAgents.map` callback, remove:
```tsx
const createdKeyForAgent = newlyCreatedKey?.agentId === agent.id ? newlyCreatedKey.key : null;
```

Remove the entire amber banner block:
```tsx
{createdKeyForAgent ? (
  <div className="mb-3 bg-amber-50 border border-amber-200 rounded-sm p-3">
    <p className="text-sm font-medium text-amber-800 mb-2">Copy this API key now. It will not be shown again.</p>
    <div className="flex items-center gap-2">
      <code className="flex-1 bg-white border border-amber-200 rounded-sm px-3 py-2 text-sm font-mono text-gray-900 break-all select-all">
        {createdKeyForAgent}
      </code>
      <Button variant="outline" size="sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCopyKey(createdKeyForAgent); }}>
        {copiedKey ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
      </Button>
    </div>
  </div>
) : null}
```

Update the keys-table empty-state condition from:
```tsx
{agentKeys.length === 0 && !createdKeyForAgent ? (
  <p className="text-sm text-gray-400">No agent-linked API keys yet.</p>
) : agentKeys.length === 0 ? null : (
```

to:
```tsx
{agentKeys.length === 0 ? (
  <p className="text-sm text-gray-400">No agent-linked API keys yet.</p>
) : (
```

- [ ] **Step 5: Add Agent ID row to each personal agent card**

After the closing `</div>` of the flex row that contains the Link + Delete button (the `className="flex items-start justify-between gap-4"` div), add:

```tsx
<div className="flex items-center gap-2">
  <span className="text-xs text-gray-500 shrink-0">Agent ID</span>
  <code className="text-xs bg-gray-100 border border-gray-200 rounded px-2 py-0.5 font-mono text-gray-600 flex-1 min-w-0 break-all">{agent.id}</code>
  <CopyButton text={agent.id} />
</div>
```

- [ ] **Step 6: Remove the per-agent `<SetupInstructions>` call (old line 542)**

Remove:
```tsx
<SetupInstructions apiKey={createdKeyForAgent ?? undefined} agentId={agent.id} />
```

- [ ] **Step 7: Add page-level Setup Instructions section after the personal agents `</section>`**

After the closing `</section>` tag of the personal agents section, inside the `<div className="space-y-8">`, add:

```tsx
<hr className="border-gray-200" />
<section>
  <div className="mb-4">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-1">Setup Instructions</h2>
    <p className="text-sm text-gray-500">
      Connect a personal agent to Index Network using any platform below. Copy your Agent ID from the card above, then generate and copy an API key.
    </p>
  </div>
  <SetupInstructions />
</section>
```

- [ ] **Step 8: Add modal render before the closing `</ClientLayout>`**

Before `</ClientLayout>`, add:

```tsx
{newlyCreatedKey && modalAgent ? (
  <ApiKeyCreatedModal
    agentName={modalAgent.name}
    agentId={newlyCreatedKey.agentId}
    apiKey={newlyCreatedKey.key}
    onClose={() => setNewlyCreatedKey(null)}
  />
) : null}
```

- [ ] **Step 9: Verify in browser**

```bash
cd frontend && bun run dev
```

Navigate to `http://localhost:5173/agents` and check:
- Personal agent cards show an "Agent ID" row with a copy button
- No collapsed "Setup Instructions" inside any agent card
- Click "Generate Key" on an agent → modal opens with amber key display + personalized setup
- Click "Done" in modal → modal closes
- Page bottom has an expanded "Setup Instructions" section with placeholder values (`YOUR_API_KEY`, `YOUR_AGENT_ID`)
- All code blocks (Claude, Hermes, OpenClaw install/update/setup) are clickable — clicking copies content and shows "✓ Copied"
- Wizard grid shows 8 prompts; first 3 value cells are clickable copy buttons

- [ ] **Step 10: Commit**

```bash
git add frontend/src/app/agents/page.tsx
git commit -m "feat(agents-page): add modal, Agent ID rows, page-level setup instructions"
```

---

### Task 5: Update `[id]/page.tsx` for consistency

**Files:**
- Modify: `frontend/src/app/agents/[id]/page.tsx`

`[id]/page.tsx` keeps its collapsible toggle on `SetupInstructions` since it appears inside a tab panel alongside other content. It gains `ClickableCodeBlock`, `WizardRow`, `WizardPromptGrid`, and `OpenClawSetup` as local functions, replacing the old `CodeBlock`-based render.

- [ ] **Step 1: Add `ClickableCodeBlock` after `CopyButton` in `[id]/page.tsx`**

`CopyButton` ends around line 550. After its closing brace, add:

```tsx
function ClickableCodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* silent */ }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="relative w-full text-left group bg-gray-50 border border-gray-200 rounded-sm p-3 hover:bg-green-50 hover:border-green-300 transition-colors"
    >
      <span className="block text-xs text-gray-700 font-mono whitespace-pre-wrap break-all pr-16">{code}</span>
      <span className="absolute top-2 right-2 text-xs text-gray-400 group-hover:text-green-700 transition-colors select-none">
        {copied ? '✓ Copied' : '⧉ Copy'}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Add `WizardRow`, `WizardPromptGrid`, `OpenClawSetup` after `ClickableCodeBlock` in `[id]/page.tsx`**

Add the same three components (identical to those in `page.tsx`):

```tsx
function WizardRow({
  prompt,
  description,
  value,
  copyable,
}: {
  prompt: string;
  description: string;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* silent */ }
  }

  return (
    <>
      <div className="flex flex-col justify-center p-3 border-b border-r border-gray-200 bg-gray-50">
        <span className="text-xs font-medium text-gray-700">{prompt}</span>
        <span className="text-xs text-gray-400 mt-0.5">{description}</span>
      </div>
      {copyable ? (
        <button
          type="button"
          onClick={handleCopy}
          className="relative group flex items-start p-3 border-b border-gray-200 bg-gray-50 hover:bg-green-50 hover:border-green-300 transition-colors text-left font-mono text-xs text-gray-700 whitespace-pre-wrap break-all"
        >
          <span className="pr-16">{value}</span>
          <span className="absolute top-2 right-2 text-xs text-gray-400 group-hover:text-green-700 transition-colors select-none">
            {copied ? '✓ Copied' : '⧉ Copy'}
          </span>
        </button>
      ) : (
        <div className="flex items-center p-3 border-b border-gray-200 text-xs text-gray-500 italic">
          {value}
        </div>
      )}
    </>
  );
}

function WizardPromptGrid({
  serverUrl,
  agentId,
  apiKey,
}: {
  serverUrl: string;
  agentId: string;
  apiKey: string;
}) {
  return (
    <div className="border border-gray-200 rounded-sm overflow-hidden">
      <div className="grid grid-cols-2 border-b border-gray-200 bg-gray-100 px-3 py-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Prompt</span>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Value</span>
      </div>
      <div className="grid grid-cols-2">
        <WizardRow prompt="Server URL" description="Index Network API endpoint" value={serverUrl} copyable />
        <WizardRow prompt="Agent ID" description="Your personal agent's unique identifier" value={agentId} copyable />
        <WizardRow prompt="API Key" description="The API key you just generated" value={apiKey} copyable />
        <div className="col-span-2 px-3 py-2 border-b border-gray-200 bg-gray-100">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Optional</span>
        </div>
        <WizardRow
          prompt="Delivery channel"
          description="Platform to receive notifications (Telegram, Discord, Slack, etc.)"
          value="select or skip"
        />
        <WizardRow
          prompt="Delivery target"
          description="Your user ID or handle on the chosen platform"
          value="your ID"
        />
        <WizardRow
          prompt="Daily digest"
          description="Receive a daily summary of opportunities"
          value="enable / disable"
        />
        <WizardRow
          prompt="Digest time"
          description="Time to send the daily digest (24-hour format)"
          value="08:00 (default)"
        />
        <WizardRow
          prompt="Max per digest"
          description="Maximum number of opportunities included per digest"
          value="10 (default)"
        />
      </div>
    </div>
  );
}

function OpenClawSetup({
  install,
  update,
  setup,
}: {
  install: string;
  update: string;
  setup: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-start">
        <div className="flex flex-col items-center pt-1 shrink-0">
          <div className="w-2 h-2 rounded-full bg-gray-300" />
          <div className="w-px h-4 bg-gray-200 my-1" />
          <div className="w-2 h-2 rounded-full bg-gray-300" />
        </div>
        <div className="flex-1 space-y-2">
          <div>
            <p className="text-xs text-gray-500 mb-1">Install (first time)</p>
            <ClickableCodeBlock code={install} />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Update (if already installed)</p>
            <ClickableCodeBlock code={update} />
          </div>
        </div>
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-1">Run setup wizard</p>
        <ClickableCodeBlock code={setup} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace the `SetupInstructions` function in `[id]/page.tsx` (lines 552–636)**

Replace the entire old `SetupInstructions` function with the new version that uses `ClickableCodeBlock`, `OpenClawSetup`, and `WizardPromptGrid`. The collapsible toggle is kept because this component lives inside an agent detail tab:

```tsx
function SetupInstructions({ apiKey, agentId }: { apiKey?: string; agentId?: string }) {
  const keyValue = apiKey || 'YOUR_API_KEY';
  const agentValue = agentId || 'YOUR_AGENT_ID';
  const [expanded, setExpanded] = useState(false);

  const protocolUrl = import.meta.env.VITE_PROTOCOL_URL || 'https://api.index.network';
  const mcpUrl = `${protocolUrl}/mcp`;

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        'index-network': {
          type: 'http',
          url: mcpUrl,
          headers: {
            'x-api-key': keyValue,
          },
        },
      },
    },
    null,
    2,
  );

  const hermesConfig = `mcp_servers:
  - name: index-network
    url: ${mcpUrl}
    headers:
      x-api-key: ${keyValue}`;

  const openclawInstall = `openclaw plugins install indexnetwork-openclaw-plugin --marketplace https://github.com/indexnetwork/openclaw-plugin`;
  const openclawUpdate = `openclaw plugins update indexnetwork-openclaw-plugin`;
  const openclawSetup = `openclaw index-network setup`;

  return (
    <div className="border border-gray-200 rounded-sm">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        Setup Instructions
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-6 border-t border-gray-100 pt-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Claude Code / OpenCode</p>
            <ClickableCodeBlock code={claudeConfig} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Hermes Agent</p>
            <ClickableCodeBlock code={hermesConfig} />
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">OpenClaw</p>
            <OpenClawSetup install={openclawInstall} update={openclawUpdate} setup={openclawSetup} />
            <WizardPromptGrid serverUrl={protocolUrl} agentId={agentValue} apiKey={keyValue} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify in browser**

```bash
cd frontend && bun run dev
```

Navigate to `http://localhost:5173/agents/{id}` (any agent's detail page). Open the "API Keys" tab and expand "Setup Instructions":
- Claude Code block is a full-width clickable copy button with preserved JSON indentation
- Hermes YAML block preserves indentation (no collapsed single line)
- OpenClaw shows tree layout with two branching nodes (Install / Update) and a Run setup wizard step below
- Wizard reference grid shows all 8 prompts with descriptions; first 3 value cells are clickable

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/agents/[id]/page.tsx
git commit -m "refactor(agents-id-page): apply ClickableCodeBlock and wizard grid to SetupInstructions"
```
