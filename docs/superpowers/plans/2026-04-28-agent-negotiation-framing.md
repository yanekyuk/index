# Agent Negotiation Framing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Frame ambient-discovery and daily-digest opportunities surfaced through OpenClaw as the result of background agent-to-agent negotiation, so users perceive the discovery as their Index agent's work rather than algorithmic output.

**Architecture:** Two switch cases in a single function (`perTypeInstruction()` in `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts`) gain an additional framing line. The framing is delivered as instruction to the user's main OpenClaw agent — the agent still speaks in its own voice but is told to open with a short line acknowledging the background negotiation. `test_message` (delivery probe) is explicitly left unframed. No MCP / `opportunity.tools.ts` changes.

**Tech Stack:** Bun runtime, TypeScript, `bun:test`. Single package: `packages/openclaw-plugin`.

**Spec reference:** [docs/superpowers/specs/2026-04-27-agent-negotiation-framing-design.md](../specs/2026-04-27-agent-negotiation-framing-design.md)

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts` | Modify `perTypeInstruction()` (lines 114-148) | Adds one framing line each to `daily_digest` and `ambient_discovery` cases. `test_message` untouched. |
| `packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts` | Add tests | Pin the framing-instruction presence on the two cases that get it, and pin its absence on `test_message`. |
| `packages/openclaw-plugin/package.json` | Bump `version` 0.19.1 → 0.20.0 | npm/workspace-facing version. Minor bump per SemVer because it is an additive behavior change. |
| `packages/openclaw-plugin/openclaw.plugin.json` | Bump `version` 0.19.1 → 0.20.0 | What `openclaw plugins list` reports. MUST match `package.json` version exactly — mismatches silently look like a no-op install. |

No new files. No changes outside `packages/openclaw-plugin/`.

---

## Task 1: Pin the framing behavior with tests, then add the framing instructions

**Files:**
- Test: `packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts`
- Modify: `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts:114-148`

The existing test file (`main-agent.prompt.spec.ts`) already covers ambient/digest invariants by asserting substring presence in the rendered prompt. We follow the same pattern: assert that the rendered prompt for `ambient_discovery` and `daily_digest` instructs the agent to frame the result as background negotiation, and assert that the `test_message` rendered prompt does NOT contain that instruction.

The test uses the word stem `negotiat` (matches "negotiate", "negotiating", "negotiation", "negotiations") so the implementer has flexibility on exact wording.

- [ ] **Step 1.1: Add the failing tests**

Open `packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts`. Append the following describe block at the bottom of the file (after the existing `INPUT-as-data defense` describe block, just before the trailing newline):

```typescript
describe('buildMainAgentPrompt — agent-negotiation framing', () => {
  it('instructs the agent to frame ambient_discovery as background agent-to-agent negotiation', () => {
    const out = buildMainAgentPrompt({
      contentType: 'ambient_discovery',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'ambient_discovery', ambientDeliveredToday: 0, candidates: [cand] },
    });
    // The agent must be told to acknowledge background negotiation —
    // either in the framing line itself or in the instruction telling
    // the agent to open with that framing.
    expect(out.toLowerCase()).toContain('negotiat');
    expect(out.toLowerCase()).toContain('background');
  });

  it('instructs the agent to frame daily_digest as a summary of background negotiations', () => {
    const out = buildMainAgentPrompt({
      contentType: 'daily_digest',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'daily_digest', candidates: [cand] },
    });
    expect(out.toLowerCase()).toContain('negotiat');
    expect(out.toLowerCase()).toContain('background');
  });

  it('does NOT add negotiation framing to test_message (delivery probe — must stay unframed)', () => {
    const out = buildMainAgentPrompt({
      contentType: 'test_message',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'test_message', text: 'ping' },
    });
    // test_message is a delivery-verification probe, not a real
    // opportunity. Framing it as the result of negotiation would be
    // misleading. Pin the absence so a future edit to the prompt
    // doesn't accidentally lump test_message in with the other cases.
    expect(out.toLowerCase()).not.toContain('negotiat');
  });
});
```

Note: the `cand` fixture and the `OpportunityCandidate` import are already at the top of the file — reuse them. The `test_message` payload shape is `{ contentType: 'test_message', text: string }`; if your local types disagree, run `grep -n "test_message" packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts` and the `MainAgentPromptInput` definition to align.

- [ ] **Step 1.2: Run the new tests and confirm they fail**

```bash
cd packages/openclaw-plugin
bun test src/tests/main-agent.prompt.spec.ts -t "agent-negotiation framing"
```

Expected: 3 failures. The first two fail because the rendered prompt does not yet contain `negotiat` / `background`. The third should already pass (negative invariant) — that is fine; it pins behavior so a later edit doesn't break it.

- [ ] **Step 1.3: Add the framing instructions to `perTypeInstruction()`**

Open `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts`. Edit the `daily_digest` and `ambient_discovery` cases inside `perTypeInstruction()` (the function spans lines 114-148; the cases are at 117-126 and 127-144 respectively). The `test_message` case at 145-146 is left exactly as-is.

The exact replacement for the `daily_digest` case (lines 117-126):

```typescript
    case 'daily_digest':
      return [
        'This is the DAILY DIGEST pass. The ambient pass already ran today and surfaced the',
        "few opportunities worth interrupting in real time; you're now sweeping up everything",
        'that was passed on. Render every candidate below as a numbered list, in your voice.',
        '',
        'Open with one short line that frames this as a summary of the background negotiations',
        "your Index agent has been running with other people's agents on the user's behalf — for",
        'example: "Here\'s what your Index agent has been working on in the background — a summary',
        'of recent negotiations." Then present the list. Speak in your own voice; the example is',
        'a tone anchor, not a template.',
        '',
        'For each opportunity you mention in your reply, you MUST first call the MCP tool',
        "`confirm_opportunity_delivery` with `trigger: 'digest'` and the opportunity's id.",
        "Do not call confirm for opportunities you don't mention.",
      ].join('\n');
```

The exact replacement for the `ambient_discovery` case (lines 127-144):

```typescript
    case 'ambient_discovery': {
      const countLine =
        payload.ambientDeliveredToday === null
          ? "Today's ambient count is unknown — lean toward selective."
          : `You have already sent ${payload.ambientDeliveredToday} ambient message(s) today (target ≤ 3).`;
      return [
        'This is the AMBIENT pass — a real-time check, not a digest. Surface only what is worth',
        'interrupting the user *right now*. Anything you skip will appear in tonight\'s daily digest,',
        'so be selective; this is the critical filter.',
        '',
        countLine,
        '',
        'If you do surface a candidate, open with one short line that frames it as the result of',
        "background negotiation between your Index agent and other people's agents — for example:",
        '"Your Index agent has been quietly negotiating with other agents — here\'s a new possibility',
        'worth surfacing." Then present the candidate. Speak in your own voice; the example is a',
        'tone anchor, not a template.',
        '',
        'For each opportunity you mention in your reply, you MUST first call the MCP tool',
        "`confirm_opportunity_delivery` with `trigger: 'ambient'` and the opportunity's id.",
        "Do not call confirm for opportunities you don't mention. If none qualify, send a",
        "one-line note saying so — don't omit the message.",
      ].join('\n');
    }
```

The `test_message` case (lines 145-146 of the original file) stays exactly as it is:

```typescript
    case 'test_message':
      return 'Delivery verification. Render the content below in your voice.';
```

Voice constraints from the spec — the framing language above intentionally avoids banned vocabulary (`leverage`, `unlock`, `optimize`, `scale`, `maximize`, `match`, "search") and uses preferred terms (`signal`, `surfaced`, `negotiation`, `background`). Do not paraphrase in a way that introduces banned words.

- [ ] **Step 1.4: Run the new tests and confirm they pass**

```bash
cd packages/openclaw-plugin
bun test src/tests/main-agent.prompt.spec.ts -t "agent-negotiation framing"
```

Expected: 3 passes.

- [ ] **Step 1.5: Run the full prompt spec to confirm no regressions**

```bash
cd packages/openclaw-plugin
bun test src/tests/main-agent.prompt.spec.ts
```

Expected: all tests pass (the existing ambient/digest invariants still hold — the additions are appended lines, no existing line was removed).

- [ ] **Step 1.6: Commit**

```bash
git add packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts \
        packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts
git commit -m "feat(openclaw-plugin): frame opportunities as background agent negotiation

Tell the user's main agent to open ambient_discovery and daily_digest
responses with a one-line acknowledgement that the candidates came from
background negotiation between its Index agent and other people's
agents. Keep the framing as instruction (with reference phrasing as a
tone anchor) so the agent speaks in its own voice. test_message is
explicitly excluded — it's a delivery probe, not a real opportunity."
```

---

## Task 2: Bump the openclaw-plugin version (both manifests)

**Files:**
- Modify: `packages/openclaw-plugin/package.json`
- Modify: `packages/openclaw-plugin/openclaw.plugin.json`

Per CLAUDE.md, the OpenClaw CLI reads the installed plugin version from `openclaw.plugin.json`, not `package.json`. If only `package.json` is bumped, `openclaw plugins install` succeeds but `openclaw plugins list` keeps showing the old number — a silent foot-gun. Both files MUST be bumped to the same version.

This is an additive behavior change (existing callers still work; the agent's responses gain new framing). Per SemVer, this is a minor bump: 0.19.1 → 0.20.0.

- [ ] **Step 2.1: Bump `package.json`**

In `packages/openclaw-plugin/package.json`, change:

```json
  "version": "0.19.1",
```

to:

```json
  "version": "0.20.0",
```

- [ ] **Step 2.2: Bump `openclaw.plugin.json` to the same version**

In `packages/openclaw-plugin/openclaw.plugin.json`, change:

```json
  "version": "0.19.1",
```

to:

```json
  "version": "0.20.0",
```

- [ ] **Step 2.3: Verify both files match**

```bash
grep -H '"version"' packages/openclaw-plugin/package.json packages/openclaw-plugin/openclaw.plugin.json
```

Expected output (both lines must show `"version": "0.20.0"`):

```
packages/openclaw-plugin/package.json:  "version": "0.20.0",
packages/openclaw-plugin/openclaw.plugin.json:  "version": "0.20.0",
```

If they disagree, fix and re-run until they match.

- [ ] **Step 2.4: Commit**

```bash
git add packages/openclaw-plugin/package.json packages/openclaw-plugin/openclaw.plugin.json
git commit -m "chore(openclaw-plugin): bump to 0.20.0 for negotiation-framing feature"
```

---

## Task 3: Move the spec to its final spot and clean the plan, then push and open the PR

**Files:**
- Delete: `docs/superpowers/specs/2026-04-27-agent-negotiation-framing-design.md`
- Delete: `docs/superpowers/plans/2026-04-28-agent-negotiation-framing.md`

Per CLAUDE.md's "Finishing a Branch" checklist, related superpowers plans/specs are deleted before merge. They served their purpose during brainstorming and execution; the implementation itself is the durable artifact.

The plan does not call for any updates to `CLAUDE.md`, `README.md`, `docs/design/`, `docs/domain/`, `docs/specs/`, or `docs/guides/` — this change is a single-file prompt edit inside `packages/openclaw-plugin`, with no architecture, domain-model, public-interface, or workflow impact.

- [ ] **Step 3.1: Delete the spec and plan**

```bash
git rm docs/superpowers/specs/2026-04-27-agent-negotiation-framing-design.md \
       docs/superpowers/plans/2026-04-28-agent-negotiation-framing.md
```

- [ ] **Step 3.2: Commit the cleanup**

```bash
git commit -m "chore(docs): remove superpowers spec and plan after implementation"
```

- [ ] **Step 3.3: Push the branch to both remotes**

```bash
git push origin feat/agent-negotiation-framing
git push upstream feat/agent-negotiation-framing
```

- [ ] **Step 3.4: Open the PR into upstream/dev**

```bash
gh pr create --repo indexnetwork/index \
  --base dev \
  --head feat/agent-negotiation-framing \
  --title "feat(openclaw-plugin): frame opportunities as background agent negotiation" \
  --body "$(cat <<'EOF'
## Summary

Add a one-line framing instruction to the OpenClaw main-agent delivery prompt for \`ambient_discovery\` and \`daily_digest\` opportunity types, telling the agent to open with an acknowledgement that the candidates came from background negotiation between the user's Index agent and other people's agents. \`test_message\` is explicitly left unframed.

The framing is delivered as instruction with reference phrasing as a tone anchor, so the agent still speaks in its own voice. No MCP / \`opportunity.tools.ts\` changes — ambient/digest are OpenClaw delivery concepts, not MCP-surface concepts.

## New Features

- Ambient discovery and daily digest responses now include a one-line preamble framing the result as background agent-to-agent negotiation.

## Tests

- Three new assertions in \`main-agent.prompt.spec.ts\` pinning framing presence on \`ambient_discovery\` and \`daily_digest\`, and framing absence on \`test_message\`.

## Versioning

- \`packages/openclaw-plugin\`: 0.19.1 → 0.20.0 (both \`package.json\` and \`openclaw.plugin.json\`).

Closes the discussion from #714 (closed in favor of this branch — same scope, refined per review feedback).
EOF
)"
```

Expected: a PR URL is printed. Capture it for the user.

---

## Self-review notes

- **Spec coverage:** Each spec section has a corresponding task — `ambient_discovery` framing (Task 1), `daily_digest` framing (Task 1), `test_message` exclusion (Task 1, negative test), voice constraints (Task 1 inline note in Step 1.3), out-of-scope items (untouched — no MCP / `opportunity.tools.ts` / web-chat / negotiation-subagent changes anywhere in the plan).
- **Placeholders:** None — every step contains the literal code or commands to run.
- **Type consistency:** The plan never invents new types or function names. The only function modified is `perTypeInstruction()`; the only test fixture used is the existing `cand` constant in the spec file.
