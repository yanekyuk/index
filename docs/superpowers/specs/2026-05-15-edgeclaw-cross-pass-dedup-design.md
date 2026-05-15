# EdgeClaw — cross-pass dedup for digest + ambient

## Problem

EdgeClaw users see the same opportunity surfaced multiple times across the day. The morning digest (08:00) lists an opportunity, the afternoon ambient pass (14:00) repeats it, and the evening ambient pass (20:00) repeats it again. Observed example: Seref's two distinct opportunities (juggling, partnerships) appeared in both the morning digest and the immediately-following ambient update.

Cause: both `prompts/digest.md` and `prompts/ambient.md` call `list_opportunities(status="pending")` independently. Neither prompt knows what the other surfaced. The ambient prompt has a `lastAmbientHash` short-circuit in `memory/heartbeat-state.json`, but that only catches "the previous ambient pass returned this exact set" — it does not look at what the morning digest delivered. The morning digest has no dedup state at all.

`confirm_opportunity_delivery` writes to the backend ledger, but that ledger is not the source of truth for digest/ambient filtering, and there is no current reason to make it so.

## Goal

Extend EdgeClaw's existing dedup pattern so the morning digest and both ambient passes share a within-day surfaced-IDs list. Each `(user, opportunityId)` pair gets surfaced at most once per host-local day. The next day's morning digest starts fresh.

## Non-goals

- Backend changes. No `list_opportunities` change, no new MCP tool, no schema migration.
- Removing `confirm_opportunity_delivery` calls. They populate the backend ledger which still serves audit, accepted-opportunity lookups (`fetchAcceptedCandidates`), and future surfaces; out of scope for this fix.
- Cross-day resurfacing policy. Today's daily rolling window is sufficient; "show again after 7 days" is a separate decision.
- Changes to `welcome.md` or other prompts. They are not in the duplication path.

## Approach

Extend `memory/heartbeat-state.json` with a `deliveredToday` block. Both prompts read it before evaluating candidates, filter the `list_opportunities` result against `deliveredToday.ids`, and append newly-surfaced IDs back to the file before ending the turn. A date stamp on the block makes it a self-resetting daily rolling window — when the date doesn't match host-local today, the list is treated as empty.

### Memory schema (additive)

`memory/heartbeat-state.json` gains one field:

```json
{
  "lastAmbientHash": "...",
  "deliveredToday": {
    "date": "2026-05-15",
    "ids": ["opp-uuid-a", "opp-uuid-b"]
  }
}
```

- `date` — host-local calendar date as `YYYY-MM-DD`.
- `ids` — opportunity UUIDs surfaced today across digest and ambient passes combined.

`lastAmbientHash` stays untouched. It serves an orthogonal purpose: short-circuiting ambient when the fetched set is unchanged since the previous ambient pass (avoids LLM quality eval on identical input).

### Read / filter / write contract

Both prompts gain a uniform contract:

1. **Read** `memory/heartbeat-state.json` near the top of the run. Tolerate a missing file or malformed JSON by treating `deliveredToday` as `{ date: today, ids: [] }`.
2. **Normalize**: if `deliveredToday.date !== <host-local today>`, replace with `{ date: today, ids: [] }` in working memory.
3. **Filter** the result of `list_opportunities` to drop any candidate whose `id` is in `deliveredToday.ids`. Filtering happens **before** the per-pass caps and quality bar so the LLM does not waste evaluation budget on candidates that will be dropped.
4. **Surface** the remaining candidates per existing prompt rules.
5. **Append** every surfaced `id` to `deliveredToday.ids` (deduplicate as a set). Write `heartbeat-state.json` back before the turn ends.

If the prompt skips surfacing (no qualifying candidates / quiet night), `deliveredToday` is still written when `date` was rolled forward — keeps the date stamp current so the next pass uses today's empty list, not yesterday's stale one.

## Prompt edits

### `packages/edgeclaw/workspace/prompts/digest.md`

Currently has no read/write of `heartbeat-state.json`. New steps:

- After step 1 (`list_opportunities`): apply the read / filter contract above. The set passed to the brief-composition step is the filtered set.
- New final step (between step 8 and 9, before "end your turn"): append surfaced IDs to `deliveredToday.ids` and write `heartbeat-state.json`.

The "Quiet night" branch (step 2) still writes the file to roll the date forward.

### `packages/edgeclaw/workspace/prompts/ambient.md`

Order with the existing `lastAmbientHash` check:

- After step 2 (`list_opportunities`) and before step 4 (`lastAmbientHash` early-exit): apply the read / filter step. The filtered set is what gets hashed and compared against `lastAmbientHash`.
- Step 10 (memory update): in addition to writing `lastAmbientHash`, append surfaced IDs to `deliveredToday.ids` and write both fields back in one file write.

Rationale for filter-before-hash: if the filter drops everything, we don't want a stale `lastAmbientHash` to make the next pass think nothing changed when in fact today's deliveries are the reason the set is empty. Hashing the *filtered* set means subsequent passes correctly recognize "we already showed this today" vs "no change in raw results."

### Surface-level wording for the prompts

Both prompts get a short paragraph in their preamble explaining the `deliveredToday` filter so the LLM treats it as a hard precondition, not an optional polish step. Phrasing to align with the existing "Hard rules" section style.

## Workspace docs

Two doc updates accompany the prompt edits:

- `packages/edgeclaw/workspace/TOOLS.md` — extend the `heartbeat-state.json` line to mention `deliveredToday` alongside `lastAmbientHash`.
- `packages/edgeclaw/README.md` — update the line describing `ambient.md`'s dedup mechanism to include cross-pass dedup via `deliveredToday`.

## Testing

EdgeClaw is prompt-driven; "tests" are scenario walks against the prompt logic. Manual verification on a test user after deploying:

1. **Same-day cross-pass dedup.**
   - Trigger morning digest manually with at least 3 pending opportunities. Confirm message delivers and `heartbeat-state.json` has `deliveredToday.date = today` and `ids = [the 3 surfaced UUIDs]`.
   - Trigger afternoon ambient pass immediately after. Confirm either "quiet night"-style silence or a message that excludes the 3 morning IDs.
   - Trigger evening ambient pass. Same expectation.

2. **Day rollover.**
   - Manually edit `heartbeat-state.json` to set `deliveredToday.date` to yesterday with a non-empty `ids` array. Trigger the next pass. Confirm IDs are not filtered out and the new write resets `date` to today with the freshly-surfaced IDs only.

3. **Missing / malformed file.**
   - Delete `heartbeat-state.json` (or corrupt it). Trigger digest. Confirm graceful handling — pass proceeds as if `deliveredToday.ids = []` and writes a fresh file.

4. **Empty result path.**
   - With no pending opportunities, trigger digest. Confirm "Quiet night" message delivered (or whichever the existing branch produces) and `deliveredToday.date` is still rolled forward to today (with `ids: []`).

5. **Confirm-delivery side-effect intact.**
   - For each surfaced opportunity, confirm `opportunity_deliveries` still gets a committed row. This is unchanged by the local-state fix; verify it didn't regress.

## Risk

- **LLM honors the filter step.** The prompt instructions are explicit and the pattern matches existing `lastAmbientHash` handling, which has shipped reliably. The filter runs before per-pass caps, so even partial drift only causes at most one redundant surface — not a runaway cascade.
- **State file drift.** A prompt crash between surfacing and writing the file would let the next pass surface the same opportunities again. Mitigation: write the file as part of the same step that finalizes the surfaced set; if the surface message is the last action, do the write immediately before the final message tool call. Worst case is one duplicate, identical to today's failure mode.
- **File contention.** EdgeClaw runs one prompt at a time; cron-fired prompts don't overlap with each other. Read-modify-write of `heartbeat-state.json` is sequential.
- **Time-zone confusion.** `date` is host-local (the agent's machine), matching how the cron schedule is host-local. Consistent within one user; no cross-host coordination needed.

## Rollout

Two prompt files edited, two doc files updated. Single PR. Bump `packages/edgeclaw/package.json` per the version-bump rule in the repo's finishing-branch checklist. No backend deploy, no protocol package release. Users get the fix when the edgeclaw plugin re-installs (or when they next re-run the installer) — same delivery mechanism as any other prompt edit.
