# Opportunity Graph – Secondary LLM Calls & Agent Placement

## Detected LLM Calls

The opportunity graph has **two** secondary LLM entry points:

| Node / Path | What runs | Agent location |
|-------------|-----------|----------------|
| **invoke_hyde** | HyDE graph → generate_missing → **HydeGenerator** | `lib/protocol/agents/hyde/hyde.generator.ts` |
| **evaluate_candidates** | **OpportunityEvaluator** (batch per-candidate analysis) | `lib/protocol/agents/opportunity/opportunity.evaluator.ts` |

No other nodes perform LLM calls. In particular:

- **resolve_source_profile** – DB only (`getProfile`).
- **search_candidates** – embedder + DB (vector search, no LLM).
- **deduplicate** – DB only (`opportunityExistsBetweenActors`).
- **persist_opportunities** – DB only (`createOpportunity`).
- **opportunity.utils** – `selectStrategies` and `deriveRolesFromStrategy` are **pure** (keyword/heuristic); no LLM, no I/O.

## Placement vs `lib/protocol/agents`

Both LLM call sites are **already implemented by agents under** `lib/protocol/agents/`:

1. **HyDE** – `agents/hyde/hyde.generator.ts` (injected into the graph via `HydeGraphFactory`).
2. **Evaluation** – `agents/opportunity/opportunity.evaluator.ts` (instantiated inside `OpportunityGraph`).

So **no new agents need to be moved or created** for the opportunity graph; the existing structure is correct.

## Template Alignment (`agent.template.md`)

| Checklist item | HydeGenerator | OpportunityEvaluator |
|----------------|---------------|----------------------|
| System prompt at top | ✓ | ✓ |
| Zod schema with `.describe()` | ✓ | ✓ |
| Types from `z.infer<>` | ✓ | ✓ |
| `invoke()` (or `generate()`) as entry point | ✓ `generate()` | ✓ `invoke()` |
| `asTool()` static factory | ❌ (used by graph injection) | ✓ |
| Spec with extended timeout (e.g. 60s) | ✓ | ✓ |
| JSDoc on public methods | ✓ | ✓ |
| Log at start and end of invoke | ✓ start | ✓ start; end added for consistency |

- **HydeGenerator** uses `BaseLangChainAgent` and a `generate()` API; it does not need Database/Embedder (cache and DB are in the graph). No change required for placement.
- **OpportunityEvaluator** is a pure evaluator (no DB/embedder). Optional improvement: add a single log at end of `invoke()` for template-style traceability (done below).

## Conclusion

- **Secondary LLM calls:** HyDE (via HydeGenerator) and candidate evaluation (via OpportunityEvaluator).
- **Placement:** Both already live under `lib/protocol/agents/`; no refactor needed.
- **Template:** Both align with the agent template; only a small logging addition was applied to the evaluator for consistency.
