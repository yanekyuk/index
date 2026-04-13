# Negotiation Polling Transport

Replace webhook-based negotiation event delivery with a polling-based agent API. Agents pull pending negotiation turns and push back responses via two REST endpoints.

## Motivation

Webhooks required agents to run a publicly reachable HTTP server, manage secrets, handle retries, and stay online — too much friction for most agent runtimes. Polling lets any agent participate with just an API key and a loop.

## Design

### Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/agents/:agentId/negotiations/pickup` | POST | API key with `metadata.agentId` | Claim the next pending negotiation turn |
| `/agents/:agentId/negotiations/:negotiationId/respond` | POST | API key with `metadata.agentId` | Submit a turn response |

Both endpoints require `manage:negotiations` permission on the agent.

### Pickup

**`POST /agents/:agentId/negotiations/pickup`**

1. Finds the oldest task in `waiting_for_agent` state where this agent's owner is a participant
2. Transitions the task to `claimed`, records `claimedByAgentId` and `claimedAt`
3. Cancels the existing 24h timeout job
4. Enqueues a new 6h "claimed abandoned" timeout job
5. Returns the opportunity and negotiation state

**Response (`200`):**

```json
{
  "negotiationId": "uuid",
  "taskId": "uuid",
  "opportunity": {
    "id": "uuid",
    "reasoning": "...",
    "roles": [...],
    "status": "..."
  },
  "turn": {
    "number": 3,
    "deadline": "2026-04-14T12:00:00Z",
    "history": [
      { "turnNumber": 1, "agent": "initiator", "action": "propose", "message": "..." },
      { "turnNumber": 2, "agent": "counterparty", "action": "counter", "message": "..." }
    ],
    "counterpartyAction": "counter"
  }
}
```

**When nothing is pending:** Returns `204 No Content`.

**Idempotency:** If the agent already has a claimed turn, pickup returns that same turn instead of claiming a second one. One claim at a time per agent.

### Respond

**`POST /agents/:agentId/negotiations/:negotiationId/respond`**

**Request body:**

```json
{
  "action": "propose" | "accept" | "reject" | "counter" | "question",
  "message": "...",
  "assessment": {
    "reasoning": "...",
    "suggestedRoles": [
      { "userId": "uuid", "role": "agent" | "patient" | "peer" }
    ]
  }
}
```

This matches the existing `NegotiationTurn` Zod schema.

**What it does:**

1. Validates the agent owns this claimed turn (task is `claimed`, `claimedByAgentId` matches)
2. Cancels the 6h timeout job
3. Persists the turn as a message with `DataPart { kind: 'data', data: NegotiationTurn }`
4. Resumes the negotiation graph from evaluation — graph decides whether to finalize or continue
5. If the next turn targets another external agent, a new `waiting_for_agent` cycle starts

**Error responses:**

- `404` — negotiation not found or not claimed by this agent
- `400` — invalid turn schema (Zod validation)
- `409` — turn already responded to (race with timeout)

**The `question` action:** The graph delivers the question to the counterparty as the next turn. Agents request extra information without accepting or rejecting.

### Task State Machine

```
submitted → working → waiting_for_agent → claimed → completed
                              ↓                        ↑
                        (6h timeout) → system agent fallback
```

New state: `claimed`. New columns on tasks: `claimedByAgentId` (FK agents), `claimedAt` (timestamp).

### Timeouts

**Never picked up (24h):** Existing `NegotiationTimeoutQueue`. No change. Task stays in `waiting_for_agent`, system agent takes over after 24h.

**Picked up but abandoned (6h):** New `NegotiationClaimTimeoutQueue`. Fires 6h after pickup. When it fires:

1. Checks task is still `claimed` (no-op if already responded)
2. Transitions task back to `waiting_for_agent`
3. Runs the system agent as fallback
4. Resumes the graph from evaluation

**Race guard:** Both the respond endpoint and the timeout worker check-and-transition atomically. If both fire simultaneously, one wins — the other gets a no-op (respond returns `409`, or timeout finds task already moved past `claimed`).

### Dispatcher Changes

The dispatcher no longer pushes anything. New flow:

1. Find authorized agents with `manage:negotiations` permission
2. Check if a personal agent exists (no transport filtering)
3. Set task to `waiting_for_agent`
4. Enqueue 24h timeout job
5. Return `waiting` so graph yields

Agent registration for negotiations becomes: create agent + grant `manage:negotiations`. No URL, no secret, no webhook server.

### Payload Design

The pickup response carries only the **opportunity and negotiation state** (turns, deadline, counterparty action). Agents use MCP tools (`read_user_profiles`, `read_intents`, etc.) to fetch additional context on demand. This keeps the payload lean and gives agents control over what they retrieve.

## Migration Scope

### Adding

- `claimed` value in task state enum
- `claimedByAgentId` and `claimedAt` columns on tasks table
- `NegotiationClaimTimeoutQueue` (6h timeout for claimed turns)
- Two endpoints on agent controller (pickup + respond)
- Service methods for pickup and respond logic

### Removing

- `webhook.queue.ts` — BullMQ webhook delivery worker
- `webhook.service.ts` — webhook CRUD service
- `webhook.controller.ts` — webhook REST endpoints
- `agent-delivery.service.ts` — webhook routing/dispatch
- `webhook-events.ts` — event type registry
- Webhook event hooks in `main.ts` (the `onTurnReceived` → `enqueueDeliveries` wiring)
- `webhooks` table — drop via migration

### Modifying

- `agent-dispatcher.service.ts` — simplified to park the turn, no push
- `agent.service.ts` — no transport filtering for negotiation dispatch
- `negotiation-timeout.queue.ts` — unchanged (24h "never picked up" stays as-is)

### Untouched

- Negotiation graph, agent, state (protocol package)
- Agent registration, permissions
- MCP server / instructions
- `agentTransports` table — stays in schema, webhook channel entries become inert
