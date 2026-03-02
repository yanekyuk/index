# Logging Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `verbose` log level, replace all `console.*` in production code with structured logger, and downgrade routine `info` logs to `verbose`.

**Architecture:** Extend the existing `log` utility in `protocol/src/lib/log.ts` with a `verbose` level (order 5, below `debug`). Then sweep through ~35 files replacing `console.*` calls and changing `logger.info(...)` to `logger.verbose(...)` for routine operations. No new infrastructure, no new dependencies.

**Tech Stack:** TypeScript, Bun, existing `log` utility

---

### Task 1: Add `verbose` level to `protocol/src/lib/log.ts`

**Files:**
- Modify: `protocol/src/lib/log.ts`

**Step 1: Add `verbose` to the LogLevel type and order map**

In `protocol/src/lib/log.ts`:

```typescript
// Line 1: Update type
type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error';

// Line 18: Update order map
const order: Record<LogLevel, number> = { verbose: 5, debug: 10, info: 20, warn: 30, error: 40 };
```

**Step 2: Add `verbose` method to `createLogger`**

Add a `verbose` method alongside `debug`, `info`, `warn`, `error` in the `createLogger` function (~line 201-230). Follow the exact same pattern as `debug`:

```typescript
verbose(message: string, meta?: Record<string, unknown>) {
  if (!shouldLogByContext(context) || !shouldLog('verbose')) return;
  const line = fmt(message, meta);
  const { start, end } = wrapWithContext(context, source, line);
  console.debug(start + line + end);  // verbose uses console.debug under the hood
},
```

**Step 3: Update `LoggerWithSource` and `LogMethod` types**

Add `verbose` to the `LoggerWithSource` type:

```typescript
export type LoggerWithSource = {
  verbose: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
};
```

**Step 4: Verify dev default stays `debug`**

Confirm `envLevel()` (line 97-102) returns `'debug'` for development — no changes needed here. `verbose` (order 5) will be filtered out by default since `debug` (order 10) > `verbose` (order 5).

**Step 5: Commit**

```bash
git add protocol/src/lib/log.ts
git commit -m "feat(log): add verbose log level below debug"
```

---

### Task 2: Downgrade `main.ts` dispatch logs to `verbose`

**Files:**
- Modify: `protocol/src/main.ts`

**Step 1: Change dispatch internals from `info` to `verbose`**

Change these lines from `logger.info` to `logger.verbose`:

- Line 130: `logger.verbose('Request', { method, path: url.pathname });`
- Line 204: `logger.verbose('Matched route', ...);`
- Line 214: `logger.verbose('Guards found', ...);`
- Line 218: `logger.verbose('Executing guard', ...);`
- Line 220: `logger.verbose('Guard execution successful');`
- Line 225: `logger.verbose('Invoking handler', ...);`
- Line 227: `logger.verbose('Handler invoked successfully');`
- Line 266: `logger.verbose('No match found', ...);`

**Keep as `info`:**
- Line 69: `logger.info('Initializing Server...');`
- Line 118: `logger.info('Routes registered', ...);`
- Line 271: `logger.info('Server running', ...);`

**Step 2: Commit**

```bash
git add protocol/src/main.ts
git commit -m "refactor(log): downgrade main.ts dispatch logs to verbose"
```

---

### Task 3: Replace `console.*` in `database.adapter.ts`

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts`

**Step 1: Add logger import and create logger instance**

At the top of the file, add:
```typescript
import { log } from '../lib/log';
const logger = log.lib.from('database.adapter');
```

**Step 2: Replace all 14 `console.error` calls**

Replace each `console.error('ClassName.methodName error:', error)` with `logger.error('ClassName.methodName error', { error: error instanceof Error ? error.message : String(error) })`.

Lines to replace: 169, 204, 237, 251, 318, 749, 816, 889, 922, 936, 963, 992, 1210.

Line 1835 is a non-fatal event hook failure — replace with `logger.warn(...)` instead of `logger.error`.

**Step 3: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "refactor(log): replace console.error with structured logger in database adapter"
```

---

### Task 4: Replace `console.*` in remaining non-CLI production files

**Files:**
- Modify: `protocol/src/lib/email/notification.sender.ts`
- Modify: `protocol/src/lib/uploads.ts`
- Modify: `protocol/src/lib/langchain/middleware/retry.ts`
- Modify: `protocol/src/lib/embedder/embedder.generator.ts`
- Modify: `protocol/src/lib/integrations/providers/slack-logger.ts`

**Step 1: `notification.sender.ts`** — Add `const logger = log.lib.from('notification.sender');` and replace 4 `console.log` calls (lines 53, 60, 113, 119) with `logger.info(...)` (these are meaningful skip-reason logs for email delivery).

**Step 2: `uploads.ts`** — Add `const logger = log.lib.from('uploads');` and replace:
- Line 138: `console.warn(...)` → `logger.warn('UnstructuredClient failed, trying fallback', { ... })`
- Line 178: `console.log(error)` → `logger.verbose('Skipping unsupported file', { error })`
- Line 187: `console.warn(error)` → `logger.warn('Failed to process file', { error })`
- Line 206: `console.warn(...)` → `logger.warn('Failed to cleanup file', { ... })`

**Step 3: `retry.ts`** — Add `const logger = log.lib.from('retry');` and replace line 37: `console.warn(...)` → `logger.warn('LLM retry attempt failed', { attempt: attempt + 1, message: (err as Error).message })`

**Step 4: `embedder.generator.ts`** — Add `const logger = log.lib.from('embedder.generator');` and replace line 58: `console.error(...)` → `logger.error('Error generating embedding', { error })`

**Step 5: `slack-logger.ts`** — Add `const logger = log.lib.from('slack-logger');` and replace line 11: `console.log(text)` → `logger.verbose('Slack integration snapshot', { text })`

**Step 6: Commit**

```bash
git add protocol/src/lib/email/notification.sender.ts protocol/src/lib/uploads.ts protocol/src/lib/langchain/middleware/retry.ts protocol/src/lib/embedder/embedder.generator.ts protocol/src/lib/integrations/providers/slack-logger.ts
git commit -m "refactor(log): replace console.* with structured logger in lib files"
```

---

### Task 5: Downgrade service layer `info` to `verbose`

**Files:**
- Modify: `protocol/src/services/intent.service.ts` — Lines 49, 81, 109, 128, 187, 255
- Modify: `protocol/src/services/chat.service.ts` — Lines 70, 94, 128, 148, 167, 199, 212, 222, 235, 255, 264, 287, 335, 362
- Modify: `protocol/src/services/opportunity.service.ts` — Lines 107, 146, 159, 239, 284, 328, 358, 444
- Modify: `protocol/src/services/index.service.ts` — Lines 24, 32, 48, 57, 65, 73, 89, 97, 105, 113, 130, 143, 151, 160, 168, 180
- Modify: `protocol/src/services/user.service.ts` — Lines 20, 47, 52
- Modify: `protocol/src/services/link.service.ts` — Lines 27, 40, 53, 71
- Modify: `protocol/src/services/file.service.ts` — Lines 33, 76, 93, 115, 128
- Modify: `protocol/src/services/profile.service.ts` — Line 44

**Step 1: In each service file, change `logger.info(...)` to `logger.verbose(...)` for all routine CRUD operations listed above.**

**Keep as `info`:**
- `auth.service.ts` line 15: Setting up default preferences (auth/onboarding side effect)
- `messaging.service.ts` line 167: XMTP sync error treated as success (side effect completion)

**Step 2: Commit**

```bash
git add protocol/src/services/*.ts
git commit -m "refactor(log): downgrade routine service logs to verbose"
```

---

### Task 6: Downgrade controller layer `info` to `verbose`

**Files:**
- Modify: `protocol/src/controllers/index.controller.ts` — Lines 21, 51, 76, 88, 143, 183, 206, 228, 240, 263, 292, 315, 338
- Modify: `protocol/src/controllers/intent.controller.ts` — Lines 76, 111, 186
- Modify: `protocol/src/controllers/chat.controller.ts` — Line 206
- Modify: `protocol/src/controllers/opportunity.controller.ts` — Lines 37, 108
- Modify: `protocol/src/controllers/profile.controller.ts` — Line 17
- Modify: `protocol/src/controllers/link.controller.ts` — Line 40
- Modify: `protocol/src/controllers/auth.controller.ts` — Lines 60, 67
- Modify: `protocol/src/controllers/user.controller.ts` — Lines 26, 44

**Step 1: Change `logger.info(...)` to `logger.verbose(...)` for all lines listed above.**

**Keep as `info`:**
- `upload.controller.ts` lines 154, 217: File/avatar upload completed (side effects)
- `queues.controller.ts` line 59: Dev queues controller initialized (startup)

**Step 2: Commit**

```bash
git add protocol/src/controllers/*.ts
git commit -m "refactor(log): downgrade routine controller logs to verbose"
```

---

### Task 7: Downgrade protocol graph `info` to `verbose`

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/intent.graph.ts` — All `logger.info` calls (~30 lines)
- Modify: `protocol/src/lib/protocol/graphs/intent_index.graph.ts` — Lines 46, 189, 297
- Modify: `protocol/src/lib/protocol/graphs/hyde.graph.ts` — All `logger.info` calls (~11 lines)
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts` — All `logger.info` calls (~40+ lines)
- Modify: `protocol/src/lib/protocol/graphs/chat.graph.ts` — Lines 99, 108, 126, 197, 232, 253, 300
- Modify: `protocol/src/lib/protocol/graphs/home.graph.ts` — All `logger.info` calls
- Modify: `protocol/src/lib/protocol/graphs/profile.graph.ts` — All `logger.info` calls
- Modify: `protocol/src/lib/protocol/graphs/index.graph.ts` — Lines 32, 99, 145, 179
- Modify: `protocol/src/lib/protocol/graphs/index_membership.graph.ts` — Lines 31, 106, 154

**Step 1: In each graph file, change ALL `logger.info(...)` calls to `logger.verbose(...)`.** Graph node entry/exit, conditional routing, and intermediate state are all verbose-level. No graph `info` calls need to stay at `info`.

**Step 2: Commit**

```bash
git add protocol/src/lib/protocol/graphs/*.ts
git commit -m "refactor(log): downgrade all graph logs to verbose"
```

---

### Task 8: Downgrade protocol agent `info` to `verbose`

**Files:**
- Modify: `protocol/src/lib/protocol/agents/intent.inferrer.ts`
- Modify: `protocol/src/lib/protocol/agents/intent.verifier.ts`
- Modify: `protocol/src/lib/protocol/agents/intent.reconciler.ts`
- Modify: `protocol/src/lib/protocol/agents/intent.indexer.ts`
- Modify: `protocol/src/lib/protocol/agents/suggestion.generator.ts`
- Modify: `protocol/src/lib/protocol/agents/lens.inferrer.ts`
- Modify: `protocol/src/lib/protocol/agents/chat.agent.ts`
- Modify: `protocol/src/lib/protocol/agents/chat.title.generator.ts`
- Modify: `protocol/src/lib/protocol/agents/profile.generator.ts`
- Modify: `protocol/src/lib/protocol/agents/profile.hyde.generator.ts`
- Modify: `protocol/src/lib/protocol/agents/hyde.generator.ts`
- Modify: `protocol/src/lib/protocol/agents/opportunity.evaluator.ts`

**Step 1: In each agent file, change ALL `logger.info(...)` calls to `logger.verbose(...)`.** Agent invocations, results, and flow decisions are all verbose-level. No agent `info` calls need to stay at `info`.

**Step 2: Commit**

```bash
git add protocol/src/lib/protocol/agents/*.ts
git commit -m "refactor(log): downgrade all agent logs to verbose"
```

---

### Task 9: Downgrade protocol support/tools/streamers + `protocol.logger.ts`

**Files:**
- Modify: `protocol/src/lib/protocol/support/protocol.logger.ts` — Lines 39, 51 (withCallLogging wrapper)
- Modify: `protocol/src/lib/protocol/support/chat.checkpointer.ts` — Lines 54, 62, 101, 105, 117
- Modify: `protocol/src/lib/protocol/support/opportunity.discover.ts` — Lines 263, 564, 584, 598
- Modify: `protocol/src/lib/protocol/support/opportunity.enricher.ts` — Line 292
- Modify: `protocol/src/lib/protocol/streamers/chat.streamer.ts` — Lines 73, 92, 255
- Modify: `protocol/src/lib/protocol/tools/index.ts` — Line 80
- Modify: `protocol/src/lib/protocol/tools/profile.tools.ts` — Lines 58, 296, 381

**Step 1: Change all `logger.info(...)` to `logger.verbose(...)` in the listed files.**

**Exception — keep as `info`:**
- `profile.tools.ts` line 390: `"Onboarding completed"` (auth side effect)

**Step 2: Commit**

```bash
git add protocol/src/lib/protocol/support/*.ts protocol/src/lib/protocol/streamers/*.ts protocol/src/lib/protocol/tools/*.ts
git commit -m "refactor(log): downgrade protocol support/tools/streamer logs to verbose"
```

---

### Task 10: Downgrade queue layer `info` to `verbose`

**Files:**
- Modify: `protocol/src/queues/hyde.queue.ts` — Lines 60, 72, 75
- Modify: `protocol/src/queues/opportunity.queue.ts` — Line 166
- Modify: `protocol/src/queues/intent.queue.ts` — Lines 222, 236
- Modify: `protocol/src/queues/notification.queue.ts` — Lines 130, 183, 189, 205, 246, 255
- Modify: `protocol/src/queues/profile.queue.ts` — Line 121

**Step 1: Change listed lines from `logger.info(...)` to `logger.verbose(...)`.**

**Keep as `info`:**
- `hyde.queue.ts` lines 62, 112: Completed cleanup/refresh with counts
- `hyde.queue.ts` lines 125, 132: Cron job scheduled (startup)
- `notification.queue.ts` line 149: Emitted opportunity notification (side effect)
- `notification.queue.ts` line 234: Enqueued high-priority email (side effect)
- `email.queue.ts` line 103: Email sent (side effect)

**Step 2: Commit**

```bash
git add protocol/src/queues/*.ts
git commit -m "refactor(log): downgrade routine queue logs to verbose"
```

---

### Task 11: Downgrade remaining lib/infrastructure `info` to `verbose`

**Files:**
- Modify: `protocol/src/lib/email/transport.helper.ts` — Line 80
- Modify: `protocol/src/lib/integrations/providers/googlecalendar.ts` — Line 77
- Modify: `protocol/src/lib/integrations/providers/gmail.ts` — Line 54
- Modify: `protocol/src/lib/integrations/providers/twitter.ts` — Lines 53, 70
- Modify: `protocol/src/lib/parallel/parallel.ts` — Lines 154, 170, 176
- Modify: `protocol/src/adapters/messaging.adapter.ts` — Line 253

**Step 1: Change listed lines from `logger.info(...)` to `logger.verbose(...)`.**

**Keep as `info`:**
- `transport.helper.ts` line 103: Email sent successfully (side effect)
- `magic-link.handler.ts` line 7: Sending magic link email (side effect)
- `googlecalendar.ts` line 113: Sync done (side effect)
- `gmail.ts` line 87: Sync done (side effect)
- `cache.adapter.ts` line 49: Redis connected (infrastructure lifecycle)
- `messaging.adapter.ts` lines 104, 117, 180, 197: XMTP client lifecycle events
- `router.decorators.ts` line 28: Controller registered (startup)
- `bullmq.ts` lines 89, 109: Queue/worker initialization (startup)

**Step 2: Commit**

```bash
git add protocol/src/lib/email/transport.helper.ts protocol/src/lib/integrations/providers/*.ts protocol/src/lib/parallel/parallel.ts protocol/src/adapters/messaging.adapter.ts
git commit -m "refactor(log): downgrade routine lib/infrastructure logs to verbose"
```

---

### Task 12: Final verification

**Step 1: Search for remaining `console.log` / `console.error` / `console.warn` in non-CLI production code**

```bash
cd protocol && grep -rn 'console\.\(log\|error\|warn\|info\|debug\)' src/ --include='*.ts' | grep -v 'src/cli/' | grep -v '.test.ts' | grep -v '.spec.ts' | grep -v 'template.md' | grep -v 'src/lib/log.ts'
```

Expected: Only documentation/comment references remain (JSDoc examples, commented-out code).

**Step 2: Verify build**

```bash
cd protocol && bun run lint
```

**Step 3: Commit any fixes, then final commit if clean**

---

## Notes

- **No tests needed**: This is a logging-level refactor. No behavior changes, no new APIs, no feature code. The existing test suite will validate nothing is broken.
- **Line numbers are approximate**: Files may have shifted since analysis. Use the log message string as the anchor for finding lines.
- **CLI scripts excluded**: `src/cli/*` files keep their `console.log` calls for user-facing terminal output.
- **Test files excluded**: Test files keep their `console.*` calls.
