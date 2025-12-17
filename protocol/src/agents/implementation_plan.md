# Intent Inferring 2.0: Restructuring & Implementation Plan

## Goal Description
Restructure the Intent Inferring system to address context drift, duplicates, and missing explicit intents. The goal is to separate concerns by splitting the monolithic inference into specialized agents (Explicit vs. Implicit) and introducing a "Self-Knowledge" component to ground implicit inferences and manage intent lifecycle.

## User Review Required
> [!IMPORTANT]
> **Intent Lifecycle**: The inferrer will now manage the full lifecycle of intents (`Create`, `Update`, `Expire`) rather than just creating new ones.
> **Structural User Memory**: A persisted `UserMemoryProfile` (Identity, Context, Aspirations) will assume the role of "Self Knowledge".
> **Evolutionary Updates**: The User Memory will evolve over time using previous state as context, rather than being wiped and recreated.

## Proposed Architecture

### 1. Intent Manager (`agents/core/intent_manager`)
**Role**: Orchestrator. Standardizes inputs and delegates to detectors.

**Workflow**:
1.  **Context Fetch**:
    -   Fetch `UserMemoryProfile` (Long-term context).
    -   Fetch `ActiveIntents` (Short-term state).
2.  **Explicit Detection**: `explicitDetector.run(content, profile, activeIntents)`
    -   **Prompt**: "Here is what the user wants right now (`activeIntents`). Here is new content. Decide whether to `Create` a new intent, `Update` an existing one, or `Expire` a completed one."
3.  **Implicit Detection**: `implicitDetector.run(content, profile, activeIntents)`
    -   Uses `profile.interests` (Long-term) and inferred context from `activeIntents` to find opportunities.
    -   Uses `activeIntents` to filter out things the user is already working on.
4.  **Action Execution**: Apply the actions returned by detectors (Create/Update/Expire).

### 2. Specialized Detectors
#### A. Explicit Detector
- **Goal**: 100% precision for stated needs.
- **Logic**: Strict extraction, removes temporal markers. Handles duplicates/updates intelligently.
- **Target**: Discovery forms, direct requests.

#### B. Implicit Detector (The "Opportunity Finder")
- **Goal**: Find value for the user based on context.
- **Sub-Agent: Experimental / Explorer**:
    - **Goal**: Serendipity.
    - **Logic**: Lower confidence threshold, broader associations.

### 3. User Memory (`agents/core/user_memory`) [NEW]
**Role**: "Self-Knowledge" service.
**Structure**:
```typescript
interface UserMemoryProfile {
  userId: string;
  identity: {
    name: string;
    bio: string; // Aggregated from intro/onboarding
  };
  attributes: {
    interests: string[]; // Inferred or explicit interests
    skills: string[];    // Professional skills
    goals: string[];     // General high-level aspirations (Context), NOT specific active intents.
  };
  // Note: 'Active Intents' are passed SEPARATELY to the manager, not embedded in this profile view.
}
```

### Lifecycle & Persistence (Evolutionary Updates)
- **Persistence**: Stored in `user_memories` table with a content checksum.
- **Evolution**: triggered by:
    1.  **Bio Updates**: Direct changes to `users.intro`.
    2.  **Intent Accumulation**: Significant new specific intents (e.g., creating 3 "AI" intents adds "AI" to `interests`).
- **Mechanism**: Input: `Old Profile` + `New Bio` + `Recent Intents`. Prompt: "Evolve this profile..."

## Execution Plan (Branches)

### Phase 1: Foundation & Explicit
**Branch**: `feat/intent-explicit-separation`
- [ ] Refactor `intent_inferrer` to Orchestrator pattern.
- [ ] Implement `ExplicitDetector` with **Intent Lifecycle Prompt** (Create/Update/Expire).
- [ ] Update input handlers (`analyzeContent`, `analyzeFolder`).

### Phase 2: User Memory (Persisted & Evolutionary)
**Branch**: `feat/user-memory-core`
- [ ] **Schema**: Create `user_memories` table in `lib/schema.ts`.
- [ ] Implement `UserMemoryBuilder` with Checksum logic.
- [ ] Implement `evolveProfile` LLM chain.

### Phase 3: Implicit Agents
**Branch**: `feat/intent-implicit-opportunity`
- [ ] Implement `ImplicitDetector`.
- [ ] Connect `UserMemoryProfile` as context.
- [ ] Implement Experimental logic.

---

## Proposed Changes

### `protocol/src/agents/core/intent_inferrer`
#### [MODIFY] [index.ts](file:///Users/aposto/Projects/index/protocol/src/agents/core/intent_inferrer/index.ts)
- Orchestrator fetching profile AND active intents.
- Handling `Create`, `Update`, `Expire` actions.

#### [NEW] [detectors/explicit.ts](file:///Users/aposto/Projects/index/protocol/src/agents/core/intent_inferrer/detectors/explicit.ts)
- Prompt accepts `activeIntents`.
- Output Schema:
  ```typescript
  {
    actions: [
      { type: 'create', payload: string },
      { type: 'update', id: string, payload: string },
      { type: 'expire', id: string, reason: string }
    ]
  }
  ```

#### [NEW] [detectors/implicit.ts](file:///Users/aposto/Projects/index/protocol/src/agents/core/intent_inferrer/detectors/implicit.ts)
- Contextual weighting.

## Verification Plan

### Automated Tests
- **Intent Lifecycle**:
    - **Context**: Active Intent "Hiring Rust Engineer" (ID: 123).
    - **Input A (Duplicate)**: "Need Rust dev." -> **No Action**.
    - **Input B (Update)**: "Actually, I need a Senior Rust Engineer." -> **Action: Update(ID:123, "Hiring Senior Rust Engineer")**.
    - **Input C (Expire)**: "Position filled." -> **Action: Expire(ID:123, "Filled")**.
    - **Input D (New)**: "Also need a Designer." -> **Action: Create("Hiring Designer")**.


### Manual Verification
- **Input**: "I want to deploy on Solana."
- **Context Profile**: `interests: ["Blockchain"]`.
- **Active Intents**: `["Deploy on Solana"]`.
- **Result**: No Action (Duplicate detected).

## User Story / Workflow Example

1.  **Onboarding**: 
    -   Alice signs up.
    -   **LLM Task**: `UserMemoryBuilder.constructProfile` runs (Input: Twitter/Parallels data).
    -   **Result**: `UserMemoryProfile` created. `interests: ["DeSci", " DAO Governance"]`.

2.  **Explicit Intent** (Discovery Form):
    -   Alice types: "I'm looking for a governance framework for my DeSci DAO."
    -   **LLM Task**: `ExplicitDetector` runs (Input: Text + `activeIntents: []`).
    -   **Action**: `Create(payload: "Looking for DeSci DAO governance framework")`.
    -   **State**: Added to `activeIntents`.

3.  **Implicit Discovery** (Slack):
    -   Alice pastes a link to a new voting tool: "Check this out."
    -   **LLM Task**: `ImplicitDetector` runs (Input: Link + `profile` + `activeIntents`).
    -   **Logic**: 
        -   "Is this relevant?" -> Yes (Matches "DAO Governance").
        -   "Is it a duplicate of 'Looking for governance framework'?" -> No (It's a specific tool/sub-task).
    -   **Result**: "Researching voting tools for DeSci governance" (High Confidence Opportunity).

4.  **Intent Update**:
    -   Alice types: "We decided to use Snapshot for now."
    -   **LLM Task**: `ExplicitDetector` runs (Input: Text + `activeIntents: ["Looking for governance..."]`).
    -   **Logic**: "Does this text contradict or complete any active intent?" -> Yes.
    -   **Result**: `Expire(id, reason: "Solution found (Snapshot)")` or `Update("Implementing Snapshot")`.

5.  **Automatic Evolution** (No manual bio update needed):
    -   System detects Alice has created multiple "DeSci DAO" related intents.
    -   **LLM Task**: `UserMemory.evolveProfile` runs (Input: `Old Profile` + `Recent Intents`).
    -   **Logic**: "User is deeply focusing on DeSci governance. Add this to high-level interests."
    -   **Result**: `interests` evolved: `["DeSci", "DAO", "Governance"]`. `goals` updated to reflect this focus.
