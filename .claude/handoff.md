---
trigger: "Update documentation: ensure README.md mentions the CLI and npm install instructions, update cli/cli-output-reference.html to reflect the current unified conversation command, and ensure docs are up-to-date with the latest CLI state (v0.7.0, unified conversation command, npm distribution)."
type: docs
branch: docs/cli-docs-update
base-branch: dev
created: 2026-03-31
version-bump: none
---

## Related Files
- README.md — no CLI mention at all, needs CLI section with npm install instructions
- cli/cli-output-reference.html — 954 lines, outdated: references "chat" command, v0.6.0, --list flag. Needs updating to unified "conversation" command, v0.7.0, current subcommands
- docs/specs/cli-v1.md — original CLI spec, partially updated
- docs/specs/cli-conversation.md — conversation command spec
- docs/specs/cli-npm-publish.md — npm distribution spec
- docs/specs/cli-profile.md — profile command spec
- docs/specs/cli-intent-command.md — intent command spec
- docs/specs/cli-opportunity.md — opportunity command spec
- docs/specs/cli-network.md — network command spec
- cli/src/main.ts — current help text and VERSION const (source of truth)

## Relevant Docs
- docs/specs/cli-v1.md
- docs/specs/cli-conversation.md
- docs/specs/cli-npm-publish.md
- docs/specs/cli-profile.md
- docs/specs/cli-network.md

## Related Issues
None — no related issues found.

## Scope
Three deliverables:

1. **README.md**: Add a CLI section near the top (after "How It Works" or in "Getting Started") covering:
   - `npm install -g @indexnetwork/cli` installation
   - Quick overview of commands: login, conversation, profile, intent, opportunity, network
   - Link to full CLI docs

2. **cli/cli-output-reference.html**: Update the full output reference to reflect current state:
   - Version: 0.6.0 → 0.7.0
   - "chat" command → "conversation" (unified command)
   - Remove --list flag references, add conversation subcommands (sessions, list, with, show, send, stream)
   - Update help text to match current cli/src/main.ts HELP_TEXT
   - Update CSS class names if needed (chat → conversation)

3. **Spec docs**: Quick pass to ensure cli-v1.md and other spec docs are consistent with current implementation (unified conversation, npm distribution, v0.7.0).
