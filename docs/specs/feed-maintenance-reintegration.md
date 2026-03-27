---
title: "Feed Maintenance Reintegration"
type: spec
tags: [feed, maintenance, composition, health-scoring, rediscovery, home]
created: 2026-03-27
updated: 2026-03-27
---

## Behavior

Reintegrate feed composition caps and proactive maintenance into the home feed pipeline. The building blocks (feed health scorer, maintenance graph, composition utilities, tests) already exist but were reverted. This spec covers re-wiring them into the active code paths.

### Feed Composition Caps

The home graph's final selection step uses `selectByComposition()` instead of a plain `.slice()` to enforce soft targets of ~3 connections, ~2 connector-flow, and ~2 expired opportunities per feed view (7 total). The algorithm fills each category up to its target, then redistributes unused slots by priority (connection > connector-flow > expired).

### Maintenance Graph Wiring

OpportunityService instantiates `MaintenanceGraphFactory` with database, cache, and queue dependencies. The `getHomeView()` method fires a maintenance check after returning results. The maintenance graph computes feed health and triggers rediscovery when the health score drops below 0.5.

### Intent Event Listeners

IntentEvents (onCreated, onUpdated, onArchived) trigger maintenance for the affected user. This ensures feed health is re-evaluated when a user's intents change, not only on home feed view.

### Observability

- Log when maintenance is triggered (source: home-view or intent-event)
- Include `meta.maintenanceTriggered` boolean in home view response

## Constraints

- Maintenance graph invocation is fire-and-forget; it must not block the home view response
- Feed composition is soft targets, not hard limits; if fewer opportunities exist than the target, show what is available
- Must respect existing architecture: services do not import other services; cross-service communication via events/queues
- MaintenanceGraph receives dependencies via constructor injection (database, cache, queue)
- Intent event listeners must not duplicate maintenance triggers (debounce or guard against concurrent runs)

## Acceptance Criteria

1. `selectByComposition()` is called in home.graph.ts instead of plain `.slice()`
2. `MaintenanceGraphFactory` is instantiated in OpportunityService constructor
3. `getHomeView()` triggers maintenance via the maintenance graph (fire-and-forget)
4. IntentEvents.onCreated, onUpdated, and onArchived trigger maintenance for the user
5. Home view response includes `meta.maintenanceTriggered` field
6. Existing tests pass: feed-health.spec.ts, feed-composition-slicing.spec.ts, maintenance-graph.spec.ts
7. No architecture rule violations (controllers do not import adapters, services do not import services, etc.)
