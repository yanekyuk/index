# EdgeClaw Cross-Pass Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop EdgeClaw's morning digest and ambient passes from re-surfacing the same opportunity within a single host-local day. Extend `memory/heartbeat-state.json` with a `deliveredToday` block that both prompts read, filter against, and write back.

**Architecture:** Prompt-only change in `packages/edgeclaw/workspace/prompts/`. Schema gains one additive field. Daily rolling window via a date stamp on the block — no explicit cleanup. No backend changes, no protocol package release.

**Tech Stack:** Markdown prompts executed by the EdgeClaw agent under the OpenClaw runtime. State persisted by the agent via its file-system tools.

**Spec:** `docs/superpowers/specs/2026-05-15-edgeclaw-cross-pass-dedup-design.md` (committed in `0f745f2a`).

---

## File Structure

Files modified by this plan:

- `packages/edgeclaw/workspace/prompts/ambient.md` — gains state-read step, filter step, expanded final state-write step.
- `packages/edgeclaw/workspace/prompts/digest.md` — gains state-read, filter, and a final state-write step (currently has none of these).
- `packages/edgeclaw/workspace/TOOLS.md` — one-line update to the `heartbeat-state.json` entry.
- `packages/edgeclaw/README.md` — one-line update to the row describing `ambient.md`'s dedup.
- `packages/edgeclaw/package.json` — version bump.

This plan's implementation tasks neither add nor delete files — only the five files above are modified. (The spec and plan markdown under `docs/superpowers/` were committed earlier in the workflow and are not in scope here.)

---

### Task 1: Add cross-pass dedup to `ambient.md`

**Files:**
- Modify: `packages/edgeclaw/workspace/prompts/ambient.md`

`ambient.md` already reads and writes `memory/heartbeat-state.json` for `lastAmbientHash`. We extend that pattern: broaden the state read to also load `deliveredToday`, insert a filter step before the hash comparison, and extend the final state-write to persist both fields.

The "Job" section is renumbered. Order is: read state → list_opps → filter → empty/hash early-exits → caps → quality bar → message → confirm → write state.

- [ ] **Step 1: Read current `ambient.md` to confirm baseline content**

Run: `cat packages/edgeclaw/workspace/prompts/ambient.md`
Expected: file matches the contents you'll be modifying — specifically, the numbered `# Job` section with steps 1–10 and the `# Hard rules` section.

- [ ] **Step 2: Replace the `# Job` section**

Edit `packages/edgeclaw/workspace/prompts/ambient.md`. Replace the entire `# Job` section (from the `# Job` heading through the line ending with `Then end your turn.` at the close of step 10) with the block below. Leave the preamble (`You are EdgeClaw…` and `# Voice`) and everything from `# Hard rules` onward untouched.

````markdown
# Job

1. Call `read_user_profiles()` (no args). If `onboardingComplete` is `false`, end your turn — ambient passes don't run while the user is still onboarding.

2. **Read dedup state.** Read `memory/heartbeat-state.json`. Treat a missing file or malformed JSON as `{}`. Resolve `deliveredToday`: if it exists and `deliveredToday.date` equals today's host-local date (`YYYY-MM-DD`), keep `deliveredToday.ids` as the dedup set; otherwise treat the dedup set as empty (the date will roll forward when you write the file back at the end). Also remember `lastAmbientHash` if present — you'll compare against it in step 5.

3. Call `list_opportunities(status="pending", limit=10)`.

4. **Filter against dedup state.** Drop any opportunity whose `id` is in the dedup set from step 2. Use this filtered set for every subsequent step (caps, quality bar, hashing, surfacing). If the filtered set is empty, jump to step 11 (write state) and then end your turn.

5. Hash the filtered set's opportunity IDs (the result of step 4, not the raw `list_opportunities` return). Compare against `lastAmbientHash` from step 2. If the hash matches, jump to step 11 (write state, with `lastAmbientHash` unchanged) and end your turn — no new signal since the previous pass.

6. **Per-dispatch cap (the routing rule):**
   - At most **3 direct opportunities** — `feedCategory: "connection"`. The receiver is a party of the opportunity. The opportunity may or may not have an introducer; the only constraint is that the receiver is NOT the introducer. These are people the user might want to reach out to directly.
   - At most **3 introducer opportunities** — `feedCategory: "connector-flow"`. The receiver IS the introducer between other parties. These are NOT surfaced as "people to message" — they are surfaced as **community intents the user might know someone for**.
   - If more than 3 of either type qualify, surface the highest-signal ones and let the rest fall to the morning digest.

7. **Quality bar:** a candidate qualifies only when you can write a one-sentence reason that is specific to *this* user's situation and would not read identically for any other user. Generic framings ("interesting profile", "might be useful", "works in a related space") do not qualify; drop them.

8. **If nothing qualifies after the bar:** jump to step 11 (write state) and end your turn without calling the `message` tool. Telling the user there's nothing worth interrupting them for is itself an interruption. The morning digest will sweep what's still pending.

9. **If at least one qualifies:** send the message via the `message` tool. Compose one or both of the following sections (skip a section that has zero qualifying candidates), mimicking the *Ambient update* exemplar in `AGENTS.md`. Flat prose, inline links — no bullet-list-of-links, no pipe rows, no tables, no link strips.

   **Section A — direct candidates** (only if any direct candidates qualified)

   Header: `**New conversations worth starting**`

   For each direct (`connection`):
   - Link the person's name to `profileUrl`.
   - Embed `acceptUrl` verbatim on a short verb phrase like "message {Name}". The URL is opaque — do not append, encode, or modify any part of it. The backend has already prepared the greeting that will pre-fill the conversation when the user clicks.

   **Section B — introducer candidates** (only if any introducer candidates qualified)

   Header: `**Help your community find their opportunities**`

   Lead-in line: `A few residents are looking for something specific. If you know someone who fits, a quick nudge goes a long way.`

   For each introducer (`connector-flow`), surface only the OTHER party's open intent — what they're looking for. **The receiver is being asked whether they know someone who fits, not asked to take an action right now.**
   - **DO link the person's name** to their `profileUrl` (the Index web profile URL — same shape as the direct section).
   - **Do NOT link the opportunity** — no `acceptUrl`. The trailing `make intro` is plain text, not a hyperlink. The connect/accept action belongs only to direct candidates; for introducer candidates the user replies to the agent if they want to act.
   - **No greeting and no `acceptUrl`.**
   - Render the line as: `[{Name}]({profileUrl}) — {their need, 1–2 sentences drawn from `mainText`}. {short closing phrase}, make intro`
   - Examples (the literal target shape — match this):
     - `[Remi](https://index.network/u/...?link_preview=false) — Looking for a technical co-founder for his regenerative education platform. Needs someone who thinks in systems and has shipped infra. Know anyone, make intro`
     - `[Kai](https://index.network/u/...?link_preview=false) — Needs people deep in decentralized discovery — agent tooling, knowledge graphs, semantic search. Bring one to his 3pm open conversation, make intro`
     - `[Celia](https://index.network/u/...?link_preview=false) — Designing governance tooling for popup communities. Coordination, consent, collective decision-making. Point her at the right people, make intro`

   If `totalPending` exceeds the candidates you surfaced, end with: `There are N more conversations waiting for you, let me know if you want to see them.`

10. For every opportunity you mention in the message, call `confirm_opportunity_delivery(opportunityId, trigger="ambient")`. Do NOT confirm for opportunities you skipped.

11. **Write dedup state.** Update `memory/heartbeat-state.json` so that:
    - `deliveredToday.date` = today's host-local `YYYY-MM-DD`.
    - `deliveredToday.ids` = the dedup set from step 2 ∪ the IDs of every opportunity you surfaced in step 9 (treat as a set; preserve order is not required, no duplicates). If you didn't surface anything (early-exit branches from steps 4, 5, or 8), `ids` is the dedup set from step 2 unchanged.
    - `lastAmbientHash` = the hash from step 5 if you surfaced a message in step 9; otherwise leave it at whatever value step 2 read (do not overwrite with a stale hash).

    Preserve any other top-level keys in the file. Then end your turn.
````

- [ ] **Step 3: Verify the file content is well-formed**

Run: `head -90 packages/edgeclaw/workspace/prompts/ambient.md`
Expected:
- The preamble, `# Voice`, and `# Job` sections are present.
- The `# Job` section has 11 numbered steps (1 through 11).
- Step 2 mentions `deliveredToday`; step 4 mentions "Filter against dedup state"; step 11 mentions both `deliveredToday` and `lastAmbientHash`.
- `# Hard rules` and everything after it are unchanged from before the edit.

- [ ] **Step 4: Sanity-check the markdown is still parseable**

Run: `awk '/^# /{print NR": "$0}' packages/edgeclaw/workspace/prompts/ambient.md`
Expected: three top-level headings — `# Voice`, `# Job`, `# Hard rules` — in that order.

- [ ] **Step 5: Commit**

```bash
git add packages/edgeclaw/workspace/prompts/ambient.md
git commit -m "feat(edgeclaw): cross-pass dedup in ambient prompt via deliveredToday"
```

---

### Task 2: Add cross-pass dedup to `digest.md`

**Files:**
- Modify: `packages/edgeclaw/workspace/prompts/digest.md`

`digest.md` currently has no read/write of `heartbeat-state.json`. We introduce the contract: read state at the top, filter, do the existing brief composition, then write state as a new final step before sending the message. The state write happens *before* the message tool call so the worst-case crash window matches today's behavior.

- [ ] **Step 1: Read current `digest.md` to confirm baseline content**

Run: `cat packages/edgeclaw/workspace/prompts/digest.md`
Expected: file matches the contents you'll be modifying — `# Voice`, `# Job`, `# Hard rules`. The `# Job` section currently has steps 1–9.

- [ ] **Step 2: Replace the `# Job` section**

Edit `packages/edgeclaw/workspace/prompts/digest.md`. Replace the entire `# Job` section (from the `# Job` heading through the end of the current step 9 `Send the brief via the message tool. After delivery, end your turn.`) with the block below. Preamble (`You are EdgeClaw…` and `# Voice`) and `# Hard rules` onward remain untouched.

````markdown
# Job
Send a morning brief to the user via the `message` tool.

1. **Read dedup state.** Read `memory/heartbeat-state.json`. Treat a missing file or malformed JSON as `{}`. Resolve `deliveredToday`: if it exists and `deliveredToday.date` equals today's host-local date (`YYYY-MM-DD`), keep `deliveredToday.ids` as the dedup set; otherwise treat the dedup set as empty (the date will roll forward when you write the file back at the end).

2. Call `list_opportunities(status="pending", limit=10)`.

3. **Filter against dedup state.** Drop any returned opportunity whose `id` is in the dedup set from step 1. Use the filtered set for everything that follows. (Filtering happens before the quality bar so the LLM does not waste evaluation budget on candidates that will be dropped.)

4. **If the filtered set is empty:** send via the `message` tool: "Quiet night — I'll keep listening." Then write `memory/heartbeat-state.json` so that `deliveredToday.date` = today's host-local `YYYY-MM-DD` and `deliveredToday.ids` = the dedup set from step 1 unchanged (preserve `lastAmbientHash` and any other top-level keys). End your turn.

5. **Otherwise** compose the brief in this exact structure (mimic the exemplar):

   ```
   🌞 Good morning from Edge Esmeralda

   It's {weekday}, {short date / week context}. Here's what to do and who to find before the day fills up.

   **{N} conversations await you** ← only if there are direct (connection) candidates — receiver is a party, NOT the introducer
   - [Name](profileUrl) — 1–2 sentences on why this person matters to the user, [message Name](acceptUrl)
   - …

   **Help your community find their opportunities** ← only if there are introducer (connector-flow) candidates — receiver IS the introducer
   A few residents are looking for something specific. If you know someone who fits, a quick nudge goes a long way.
   - [{Name}]({profileUrl}) — {their need / what they're looking for, 1–2 sentences from mainText}. {short closing phrase}, make intro
   - …
   ```

   Skip a section that has zero candidates.

   **Critical rendering distinction for the introducer section:** these are *community intents* the user might know someone for — NOT opportunity cards.
   - DO link the person's name to their `profileUrl` (the Index web profile URL — same shape as the direct section).
   - Do NOT link the opportunity — no `acceptUrl`. The trailing `make intro` is plain text, not a hyperlink. The connect/accept link belongs only in the direct (`connection`) section. If the user wants to act on an introducer item, they reply to the agent and the agent handles it next turn.

6. **Quality bar (apply per candidate):** a candidate qualifies only if you can write a one-sentence reason that is specific to *this* user's situation and would not read identically for any other user. Drop generic framings.

7. **URL rules:** weave links into prose. The strip-the-URLs test is the rule — if a reader removes every link, the prose still reads coherently. NO bullet-list-of-links, NO link tables, NO action strips, NO blockquote whose body is link labels.

8. **acceptUrl handling (connection candidates only):** Embed `acceptUrl` verbatim on a short verb phrase. The URL is opaque — do not append, encode, or modify any part of it. The backend has already prepared the greeting that will pre-fill the conversation when the user clicks. **`connector-flow` candidates carry no `acceptUrl`** — those trigger an introduction approval, not a direct conversation.

9. For every opportunity you mention in the brief, call `confirm_opportunity_delivery(opportunityId, trigger="digest")`. Do NOT confirm for opportunities you skipped.

10. If `totalPending` exceeds the candidates you surfaced, end with: `There are N more conversations waiting — let me know if you want to see them.`

11. **Write dedup state.** Update `memory/heartbeat-state.json` so that:
    - `deliveredToday.date` = today's host-local `YYYY-MM-DD`.
    - `deliveredToday.ids` = the dedup set from step 1 ∪ the IDs of every opportunity you mentioned in the brief (treat as a set; no duplicates).

    Preserve any other top-level keys (e.g. `lastAmbientHash`).

12. Send the brief via the `message` tool. After delivery, end your turn.
````

- [ ] **Step 3: Verify the file content is well-formed**

Run: `head -120 packages/edgeclaw/workspace/prompts/digest.md`
Expected:
- The `# Job` section has 12 numbered steps (1 through 12).
- Step 1 mentions `deliveredToday`; step 3 mentions "Filter against dedup state"; step 4 handles the empty/quiet-night branch with a state write; step 11 mentions both `deliveredToday.date` and `deliveredToday.ids`; step 12 sends the brief.
- `# Hard rules` is unchanged.

- [ ] **Step 4: Sanity-check the markdown is still parseable**

Run: `awk '/^# /{print NR": "$0}' packages/edgeclaw/workspace/prompts/digest.md`
Expected: three top-level headings — `# Voice`, `# Job`, `# Hard rules` — in that order.

- [ ] **Step 5: Commit**

```bash
git add packages/edgeclaw/workspace/prompts/digest.md
git commit -m "feat(edgeclaw): cross-pass dedup in digest prompt via deliveredToday"
```

---

### Task 3: Update workspace docs

**Files:**
- Modify: `packages/edgeclaw/workspace/TOOLS.md:51`
- Modify: `packages/edgeclaw/README.md:209`

Update the two doc lines that describe the dedup mechanism so they mention the new field. Both edits are single-line changes.

- [ ] **Step 1: Update `workspace/TOOLS.md` line 51**

Edit `packages/edgeclaw/workspace/TOOLS.md`.

Replace:
```
- `memory/heartbeat-state.json` — last-run timestamps for heartbeat tasks (so intervals survive restarts) and dedup hashes (e.g. `lastAmbientHash`).
```

With:
```
- `memory/heartbeat-state.json` — last-run timestamps for heartbeat tasks (so intervals survive restarts) and dedup state: `lastAmbientHash` (ambient pass short-circuit) and `deliveredToday` (cross-pass surfaced-IDs list, resets daily; shared by `digest.md` and `ambient.md`).
```

- [ ] **Step 2: Update `README.md` line 209**

Edit `packages/edgeclaw/README.md`.

Replace:
```
| `prompts/ambient.md` | Self-contained prompt for the 14:00 + 20:00 ambient discovery crons. Selective: max 3 direct + 3 introducer per dispatch, dedup via `memory/heartbeat-state.json:lastAmbientHash`. |
```

With:
```
| `prompts/ambient.md` | Self-contained prompt for the 14:00 + 20:00 ambient discovery crons. Selective: max 3 direct + 3 introducer per dispatch. Dedup: `memory/heartbeat-state.json:lastAmbientHash` (skip pass when the fetched set is unchanged) + `deliveredToday` (drop opportunities already surfaced earlier today by digest or ambient). |
```

Also replace (same file, line 208):
```
| `prompts/digest.md` | Self-contained prompt for the daily 08:00 digest cron. |
```

With:
```
| `prompts/digest.md` | Self-contained prompt for the daily 08:00 digest cron. Filters against `memory/heartbeat-state.json:deliveredToday` so opportunities already surfaced earlier today are skipped. |
```

- [ ] **Step 3: Verify**

Run: `grep -n "deliveredToday" packages/edgeclaw/workspace/TOOLS.md packages/edgeclaw/README.md`
Expected: three matches total — one in `TOOLS.md`, two in `README.md` (one each for `digest.md` and `ambient.md` rows).

- [ ] **Step 4: Commit**

```bash
git add packages/edgeclaw/workspace/TOOLS.md packages/edgeclaw/README.md
git commit -m "docs(edgeclaw): document deliveredToday cross-pass dedup field"
```

---

### Task 4: Bump `packages/edgeclaw/package.json` version

**Files:**
- Modify: `packages/edgeclaw/package.json`

Per the repo's finishing-branch checklist, every touched package gets a SemVer bump. Current version is `0.1.0`. This change adds new prompt behavior (a feature) — bump the MINOR to `0.2.0`.

- [ ] **Step 1: Update the version field**

Edit `packages/edgeclaw/package.json`.

Replace:
```json
  "version": "0.1.0",
```

With:
```json
  "version": "0.2.0",
```

- [ ] **Step 2: Verify**

Run: `grep '"version"' packages/edgeclaw/package.json`
Expected: `  "version": "0.2.0",`

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/package.json
git commit -m "chore(edgeclaw): bump version to 0.2.0"
```

---

### Task 5: Manual scenario verification

**Files:** none modified.

EdgeClaw is prompt-driven; correctness checks here are scenario walks against a running agent. Run these against the test EdgeClaw deployment (or whichever environment is wired to a non-production Index Network backend). For each scenario, capture the resulting `memory/heartbeat-state.json` and the agent's message output.

This task is **not committed** — it is a verification gate. Only proceed past it if every scenario behaves as described.

- [ ] **Scenario A: same-day cross-pass dedup**

Setup: a test user with at least 3 pending opportunities (`status="pending"`).

1. Manually trigger the digest cron for that user (or send the digest prompt content as a one-off message).
2. Confirm the brief delivers via the `message` tool and mentions all 3 (or however many qualify).
3. Read `memory/heartbeat-state.json` from the agent's workspace. Expect:
   - `deliveredToday.date` = today's `YYYY-MM-DD`.
   - `deliveredToday.ids` is a 3-element array containing the surfaced opportunity UUIDs.
4. Manually trigger an ambient pass for the same user without changing the underlying opportunities.
5. Expect: the ambient pass either ends without calling the `message` tool, or surfaces only opportunities that are NOT in `deliveredToday.ids`. The 3 IDs from step 3 must not reappear in the user-visible output.
6. Repeat step 4 with an evening ambient pass. Same expectation.

- [ ] **Scenario B: day rollover**

1. Manually edit `memory/heartbeat-state.json` so `deliveredToday.date` is yesterday's date and `deliveredToday.ids` has at least one UUID that matches a currently-pending opportunity for the test user.
2. Trigger the digest (or any pass).
3. Expect: the previously-listed opportunity IS surfaced (date didn't match, so the dedup set was treated as empty). After the pass, `deliveredToday.date` = today's date and `deliveredToday.ids` contains the freshly-surfaced IDs only (no carry-over from yesterday).

- [ ] **Scenario C: missing or malformed state file**

1. Delete `memory/heartbeat-state.json` (or write a deliberately malformed payload like `{not-json`).
2. Trigger the digest.
3. Expect: the pass proceeds as if the dedup set is empty, surfaces opportunities as normal, and writes a fresh `heartbeat-state.json` with `deliveredToday.date` = today and `deliveredToday.ids` populated.

- [ ] **Scenario D: empty result path**

1. Use a test user with zero pending opportunities.
2. Trigger the digest.
3. Expect: the "Quiet night — I'll keep listening." message delivers. After the pass, `heartbeat-state.json` exists with `deliveredToday.date` = today and `deliveredToday.ids` = `[]` (or matches whatever was there if today's date was already recorded).

- [ ] **Scenario E: confirm-delivery side-effect intact**

1. Use the same test user as Scenario A, but reset `opportunity_deliveries` for that user beforehand (or query the count).
2. Trigger the digest.
3. Expect: for each opportunity surfaced in the brief, a new row appears in `opportunity_deliveries` with `trigger='digest'`, `delivered_at IS NOT NULL`, `channel='openclaw'`. This confirms the local-state fix did not regress the backend ledger writes.

- [ ] **Step 6: After all scenarios pass, this task is done.**

No commit — the verification is the deliverable. If any scenario fails, return to the prompt edits (Tasks 1 / 2) and rerun.

---

## Spec coverage check (self-review)

- [x] Cross-pass dedup between digest and both ambient passes → Tasks 1 & 2.
- [x] Daily rolling window via `deliveredToday.date` → Tasks 1 & 2, scenario B.
- [x] Filter before quality bar / caps → Tasks 1 & 2 step ordering (filter is step 4 in ambient, step 3 in digest; quality bar comes after).
- [x] `lastAmbientHash` preserved as orthogonal early-exit → Task 1 step 5 hashes the *filtered* set.
- [x] Tolerate missing / malformed state file → Tasks 1 & 2 explicit instructions; scenario C.
- [x] `confirm_opportunity_delivery` calls unchanged → Tasks 1 step 10 and 2 step 9; scenario E.
- [x] Workspace docs updated → Task 3.
- [x] Version bump → Task 4.
- [x] Manual scenario verification → Task 5.

No spec requirements left unaddressed. No tasks reference undefined symbols. Step counts: `ambient.md` has steps 1–11; `digest.md` has steps 1–12. Both match the bodies of Tasks 1 and 2 respectively.
