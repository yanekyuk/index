---
trigger: "Merge CLI chat command into conversation — conversation should handle H2A (agent chat with SSE streaming, REPL, session management) in addition to H2H (DMs). Remove the separate chat command."
type: refactor
branch: refactor/cli-unify-chat
base-branch: dev
created: 2026-03-30
version-bump: patch
linear-issue: IND-199
---

## Related Files
- cli/src/chat.command.ts (SSE streaming, REPL, one-shot, session list — to be merged)
- cli/src/conversation.command.ts (H2H DM handlers — absorbs chat capabilities)
- cli/src/main.ts (thin dispatcher routing chat and conversation separately)
- cli/src/args.parser.ts (ParsedCommand, KNOWN_COMMANDS, chat flags)
- cli/src/api.client.ts (chat + conversation API methods)
- cli/src/output/formatters.ts (sessionTable, conversationTable)
- cli/src/output/base.ts (PROMPT_STR, chatHeader, status helpers)
- cli/src/types.ts (ChatSession, StreamChatParams)
- cli/tests/chat.command.test.ts
- cli/tests/conversation.command.test.ts

## Relevant Docs
- docs/specs/cli-v1.md
- docs/specs/cli-conversation.md

## Related Issues
- IND-199 Design Index CLI — clarify A2A, H2A, H2H terminology (Done)

## Scope
Unify the CLI under a single conversation command. Everything is a conversation.

Target surface:
- index conversation — Interactive REPL with AI agent (was: index chat)
- index conversation "msg" — One-shot to AI agent (was: index chat "msg")
- index conversation list — List ALL conversations (H2A + H2H)
- index conversation with <user-id> — DM a user
- index conversation show <id> — Show messages
- index conversation send <id> <message> — Send a message
- index conversation stream — Real-time SSE
- index conversation sessions — List H2A sessions (was: index chat --list)

Steps:
1. Move REPL, one-shot, streamToTerminal from chat.command.ts into conversation.command.ts
2. Bare index conversation (no subcommand) = start REPL
3. Positional text with no subcommand match = one-shot message
4. Add sessions subcommand for H2A session listing
5. Remove chat from ParsedCommand, KNOWN_COMMANDS, main.ts
6. Update args parser, help text, tests
7. Delete or repurpose chat.command.ts (keep renderSSEStream as shared utility)
