# Context Brokers

Context Brokers are autonomous agents that monitor the intent stream to discover valuable connections, insights, and opportunities within the network. They act as "matchmakers" or "researchers" that constantly evaluate how new and existing intents relate to each other.

## Overview

The Context Broker system is designed to be:
- **Autonomous**: Reacts to lifecycle events (creation, update, archive) of intents.
- **Pluggable**: New brokers can be easily added to specialized logic.
- **Privacy-Aware**: Respects index boundaries and user permissions.
    - **Index Isolation**: Intents are strictly siloed by "Index" (network/community).
    - **Mechanism**: The `findRelatedIntents` method in `base.ts` strictly filters vector searches to only include intents that share at least one Index ID with the source intent.
    - **Result**: A user in "Index A" will never be matched with a user in "Index B" unless the specific intent was explicitly shared to both indexes.

## Architecture

The system is built on a few core components:

### 1. BaseContextBroker (`base.ts`)
The abstract base class that provides common utilities for all brokers:
- **Vector Search**: `findRelatedIntents` uses vector embeddings to find semantically similar intents, enforcing index privacy.
- **Stake Management**: Methods to create and manage "Stakes" (potential connections).
- **Confidence Scoring**: `calculateWeightedStake` to weight connections based on inference confidence.

### 2. Connector (`connector.ts`)
Handles the lifecycle and registration of brokers:
- Initializes brokers on startup from the `agents` table.
- Broadcasts intent events (`onIntentCreated`, `onIntentUpdated`, `onIntentArchived`) to all registered brokers.

### 3. Semantic Relevancy Broker (`semantic_relevancy/`)
The primary implementation that focuses on finding mutual value between users.

#### Workflow:
1.  **Vector Discovery**: When a new intent is created, it finds the top 20 most similar users using vector search.
2.  **Mutuality Evaluation (Stage 1)**:
    -   Compares the new intent against the candidate users' intents.
    -   Uses an LLM (`evaluateIntentPairMutuality`) to determine if there is a **mutual** value (score >= 70).
    -   It looks for complementary needs (e.g., Investor + Founder), not just similarity.
3.  **Ranking (Stage 2)**:
    -   Takes successful mutual matches and existing stakes.
    -   Uses an LLM to rank the top 10 pairs based on semantic quality, specificity, and contextual recency.
4.  **Stake Update**:
    -   Updates the database with the best connections ("Stakes").
    -   These stakes are then used by other systems (like the `intro-maker`) to suggest introductions.

## Key Concepts

-   **Intent**: A unit of user motivation (e.g., "I want to find a co-founder").
-   **Stake**: A quantified relationship between two or more intents. It represents a potential "bet" that these users should connect.
-   **Mutuality**: The core metric for the Semantic Relevancy Broker. It distinguishes between "similar" (two people looking for jobs) and "mutual" (a recruiter looking for a candidate).

## Adding a New Broker

To create a new Context Broker:

1.  Create a class extending `BaseContextBroker`.
2.  Implement the abstract methods: `onIntentCreated`, `onIntentUpdated`, `onIntentArchived`.
3.  Register the broker in `connector.ts` in the `BROKER_IMPLEMENTATIONS` map, linking it to a specific Agent ID.

```typescript
// Example
export class MyNewBroker extends BaseContextBroker {
  async onIntentCreated(intentId: string) {
    // Your logic here
  }
  // ...
}
```
