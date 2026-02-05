# Protocol Graphs

LangGraph workflows in the Index Network protocol. Graphs are built with injected dependencies (database, embedder, etc.) and expose a compiled runnable. Most use a **factory** with `createGraph()`; the **Opportunity** graph uses a class with `compile()`.

| Graph | Purpose | README |
|-------|---------|--------|
| **Chat** | ReAct-style agent loop for user conversations; tools call intent, profile, index, opportunity graphs; confirmation and clarification flows for update/delete and create | [chat/README.md](./chat/README.md) |
| **HyDE** | Hypothetical document generation and embedding (cache-aware); used by opportunity discovery | [hyde/README.md](./hyde/README.md) |
| **Index** | Intent–index assignment: evaluate intent vs index/member prompts, then assign or unassign | [index/README.md](./index/README.md) |
| **Intent** | Extract intents from content, verify, reconcile (create/update/expire), execute against DB | [intent/README.md](./intent/README.md) |
| **Opportunity** | HyDE-based opportunity detection: resolve profile → HyDE → search → dedupe → evaluate → persist | [opportunity/README.md](./opportunity/README.md) |
| **Profile** | Load or generate user profile, embed, and optionally generate/embed HyDE description | [profile/README.md](./profile/README.md) |

Each README in the table above includes:

- **Overview** and when to use the graph
- **Input/output** (state fields and types)
- **Code samples** (create factory, compile, invoke)
- **Example input and output** (JSON or TypeScript)
- **File structure** and related docs

For the standard graph structure (state, factory, nodes), see [graph.template.md](./graph.template.md).
