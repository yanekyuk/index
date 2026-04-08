# Agent Transport Cutover

**Date:** 2026-04-08
**Scope:** `backend/src/services/`, `backend/src/adapters/`, `backend/src/queues/`, `backend/src/main.ts`, `backend/src/protocol-init.ts`, `packages/protocol/src/negotiation/`
**Depends on:** [Agent Registry](2026-04-08-agent-registry-design.md)
**Purpose:** Define the runtime cutover from legacy `webhooks` delivery to agent-registry-backed webhook transports without violating the existing controller/service/adapter layering rules.

## Problem

The agent-registry rollout added `agents`, `agent_transports`, and `agent_permissions`, but runtime event delivery still reads directly from the legacy `webhooks` table. That leaves the new registry partially integrated: agents can be created, authorized, and linked to MCP identity, but webhook dispatch still bypasses agent authorization and transport ownership.

The remaining work is not a pure cleanup step. It changes runtime behavior and therefore needs an explicit design for:

1. how event subscriptions map onto agent transports
2. how authorization gates runtime delivery
3. how to preserve current webhook payloads, signatures, and job IDs during cutover
4. how to migrate safely without breaking existing webhook users

## Goals

- Make runtime webhook delivery agent-registry-aware
- Preserve explicit event subscription semantics from legacy webhooks
- Require authorization before dispatching to an agent transport
- Keep queue payload shape, event names, HMAC signing, and job IDs unchanged during cutover
- Preserve architecture boundaries: controllers and protocol code do not query legacy webhook tables directly
- Allow a temporary fallback to legacy `webhooks` when no eligible agent transport exists

## Non-Goals

- Full removal of legacy `/api/webhooks` routes in this phase
- Removal of webhook MCP tools in this phase
- New event types or a broader permission vocabulary
- MCP transport runtime dispatch implementation
- System-agent fallback redesign for negotiations

## Design

### 1. Dispatch Eligibility Model

Runtime dispatch uses a dual gate.

A webhook transport is eligible only when both conditions are true:

1. the parent agent is authorized for the event's required action
2. the transport explicitly subscribes to that event

This preserves the current explicit-subscription model while enforcing the new agent-permission model.

### 2. Event To Action Mapping

The current emitted runtime events map to `manage:negotiations`.

| Event | Required action |
|------|------------------|
| `negotiation.started` | `manage:negotiations` |
| `negotiation.turn_received` | `manage:negotiations` |
| `negotiation.completed` | `manage:negotiations` |
| `opportunity.created` | `manage:negotiations` |

`opportunity.created` is slightly broader semantically, but in the current branch it still serves the same broker/agent workflow, so introducing a new action family during cutover would add complexity without changing runtime intent.

### 3. Webhook Transport Contract

Webhook transport config becomes runtime-significant.

```ts
type WebhookTransportConfig = {
  url: string;
  secret?: string;
  events: string[];
  legacyWebhookId?: string;
  migratedFrom?: 'webhook';
};
```

Rules:

- `events` is required for runtime webhook dispatch
- `secret` remains stored internally for signing, but is always redacted from API/tool responses
- migrated transports keep traceability metadata like `legacyWebhookId`
- transports without `events` are considered non-deliverable during the agent-registry path

### 4. Runtime Flow

`AgentDeliveryService` becomes the only runtime entrypoint for webhook fanout.

For each emitted event:

1. map `event -> requiredAction`
2. query authorized agents via `agentDatabase.findAuthorizedAgents(userId, requiredAction, scope?)`
3. filter those agents' transports to:
   - `channel === 'webhook'`
   - `active === true`
   - `config.events` contains the emitted event
4. enqueue one `deliver_webhook` job per eligible transport
5. preserve the current queue payload shape and job ID format exactly

The queue implementation remains unchanged in this phase.

### 5. Cutover Compatibility

The cutover uses fallback behavior to preserve current delivery semantics.

If no eligible agent webhook transports are found for a given user/event, `AgentDeliveryService` falls back to the existing legacy `webhooks` lookup and fanout path.

This fallback is temporary and exists only to avoid dropping deliveries while old data and old clients still exist.

Compatibility constraints:

- legacy `webhooks` remains the fallback source, not the primary path
- migrated webhook-shaped transports should have `config.events` backfilled from legacy `webhooks.events`
- newly created agent webhook transports must persist `config.events`
- no claim of ongoing sync from legacy `webhooks` into `agent_transports`

### 6. Architecture Boundaries

The cutover must preserve the repo's layering rules.

- `main.ts` and protocol graphs only emit events or call the delivery seam
- `AgentDeliveryService` owns dispatch orchestration
- adapters own data access and queue-facing details
- protocol code stays injected against interfaces, not backend concrete implementations
- controllers do not query legacy webhook tables directly
- no new sideways service-to-service coupling beyond the composition root

### 7. Implementation Phases

#### Phase 1: Transport Contract

- update webhook transport creation and migration paths so `config.events` is populated
- preserve secret redaction everywhere

#### Phase 2: Delivery Service Cutover

- extend `AgentDeliveryService` to support:
  - `event -> action` mapping
  - authorized-agent lookup
  - event subscription filtering on transports
  - unchanged queue job creation from agent transports
  - legacy fallback when no eligible agent transport exists

#### Phase 3: Verification

Add targeted tests for:

- permission + event dual gating
- secret redaction remaining intact
- fallback only when no eligible agent transport exists
- unchanged queue payloads and job IDs
- negotiation yield path still using the delivery seam correctly

#### Phase 4: Future Cleanup

Only after runtime evidence shows agent transports fully cover expected traffic:

- remove legacy webhook fallback
- separately plan removal of webhook MCP tools and `/api/webhooks` controller routes

## Risks

### Missing `events` On Existing Agent Transports

If transports exist without `config.events`, they will be skipped by the new primary path. The fallback prevents silent delivery loss during transition, but the implementation should log these skips so they can be cleaned up.

### Over-Broad Permission Mapping

Mapping `opportunity.created` to `manage:negotiations` is intentionally pragmatic, not ideal. If event coverage broadens later, a more explicit action vocabulary may be needed.

### Incomplete Cleanup Pressure

The branch should not remove legacy webhook controller/MCP/runtime code just because the agent-registry path exists. Compatibility remains a real external API concern.

## Verification Strategy

Minimum expected verification for implementation:

- targeted backend tests for delivery service and agent service
- backend typecheck
- protocol build
- frontend build if transport config/API responses change

Suggested commands:

```bash
cd backend && bun test tests/agent.service.test.ts tests/mcp.test.ts src/services/tests/agent-delivery.service.spec.ts
cd backend && npx tsc --noEmit
cd packages/protocol && bun run build
```

## Outcome

After this cutover phase:

- runtime delivery prefers agent-registry webhook transports
- authorization and event subscription both gate dispatch
- existing payload/signature behavior stays stable
- legacy webhooks remain only as a temporary compatibility fallback
