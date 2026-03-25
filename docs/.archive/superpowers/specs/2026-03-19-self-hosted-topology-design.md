# Self-Hosted Topology Design

## Context

Index Network is transitioning from a centralized monolith to a decentralized architecture where every user has their own agent and discovery happens through A2A negotiations between agents and networks.

## Core Concepts

### Agent

An autonomous unit representing one user.

- **Owns** the user's intents, profile, and embeddings (source of truth)
- **Speaks A2A** as its only external interface
- **Pushes** intents and profile updates to all joined networks
- **Queries** networks for candidate matches against its intents
- **Initiates** direct A2A negotiations with candidate agents
- **Hosts** a chat interface for the user to interact with it

An agent is an agent regardless of deployment — hosted by Index Network alongside thousands of others, running solo on a VPS, or one of several on a small team's server. Networks cannot distinguish between hosted and self-hosted agents.

### Network (Index)

A discovery service for a group of agents. Maps directly to the current "index" concept.

- **Stores** full replicated intents with embeddings from member agents (push model — agents always initiate)
- **Runs** candidate discovery via vector similarity search across all member intents
- **Serves** search queries from member agents, returning candidates (agent endpoints + relevant intents)
- **Manages** membership via existing mechanisms (invite links, public/private networks)
- **Does not** negotiate on behalf of agents — it surfaces candidates, agents decide what to do

Networks are also self-hostable. Anyone can run a private discovery network.

## Topology

```text
┌─────────┐         ┌─────────────┐         ┌─────────┐
│ Agent A  │──A2A───►│  Network X  │◄──A2A───│ Agent B  │
│ (hosted) │◄──A2A───│  (private)  │───A2A──►│ (self-  │
└─────────┘         └─────────────┘         │  hosted) │
     │                                       └─────────┘
     │              ┌─────────────┐               │
     └────A2A──────►│  Network Y  │◄────A2A───────┘
                    │  (public)   │
                    └─────────────┘
```

- Agents join multiple networks
- Networks have many member agents
- All communication is A2A — hosting model is invisible at the protocol level

## Lifecycle

1. **Setup** — User gets an agent (hosted by default, or self-hosted)
2. **Join** — Agent joins networks via invite links or public join (existing mechanisms)
3. **Replicate** — Agent pushes intents, profile, and embeddings to all joined networks
4. **Discover** — Agent queries networks: "who matches this intent?" Network returns candidates
5. **Negotiate** — Agent initiates direct A2A conversation with candidate agents (negotiation protocol TBD)
6. **Update** — When intents change, agent pushes updates to all networks

## Data Ownership

| Data | Owner | Networks get |
|------|-------|-------------|
| Intents | Agent (source of truth) | Full copy with embeddings (pushed by agent) |
| Profile | Agent (source of truth) | Full copy with embeddings (pushed by agent) |
| Embeddings | Agent computes | Replicated to networks for search |
| Match candidates | Network computes | Returned to querying agent |
| Negotiation state | Agents (peer-to-peer) | Networks are not involved |

## Interface

**A2A is the only interface** between all components:

- Agent ↔ Network: intent replication, search queries, membership
- Agent ↔ Agent: negotiation (protocol TBD, out of scope)

## Deployment Models

The architecture supports any deployment topology:

- **Multi-tenant node** — One process hosts many agents and/or networks (the hosted offering)
- **Single agent** — One agent per process on a user's own infrastructure
- **Small cluster** — A few agents and a network on a team's server

The deployment model is an operational concern, not an architectural one. The A2A interface is identical in all cases.

## Scope Boundaries

### In scope (this design)
- Agent and network as independent A2A-speaking units
- Intent replication (agent pushes to networks)
- Discovery flow (agent queries network, network returns candidates)
- Data ownership model
- Deployment topology independence

### Out of scope (separate designs)
- A2A negotiation protocol between agents
- Agent-to-agent trust/verification
- Packaging and distribution (Docker, npm, one-click deploy)
- Multi-tenancy implementation details
- Migration path from current monolith
- Code organization (packages, modes, entry points)

## Relationship to Current Codebase

The current monolith contains all the building blocks:

- **Intent management, embeddings, profile generation** → becomes the Agent
- **Index membership, vector search, opportunity discovery** → becomes the Network
- **A2A conversations, messages, tasks** → becomes the inter-agent protocol layer
- **Better Auth, chat interface** → stays with the Agent

No code organization decisions are made in this design. The split (separate packages, modes, entry points) is a later decision once the boundary is proven through implementation.
