# Intent Inferring & Opportunity Finding: Implementation Plan

## Goal Description
Build a system that not only understands what a single user wants (Intent Inference) but actively creates value by connecting users with mutual interests and goals (Opportunity Finding). 

The core philosophy shifts from just "detecting intents" to "discovering opportunities" which involves:
1.  **Parallel.ai Integration**: Fetch external data to build a rich user profile from scratch.
2.  **Profile Generation**: Create structured `UserProfile` and `ImplicitIntents` from scraped data.
3.  **Bootstrap Promotion**: Automatically promote the top N implicit intents to Explicit for new users to jumpstart their experience.
4.  **Opportunity Finding**: Profile-first matching that results in Stakes.

## User Review Required
> [!IMPORTANT]
> **Parallel.ai Search**: We will use a new `parallel` lib to fetch user data via the search API (one-shot mode).
> **Bootstrapping**: New users will have their first N implicit intents automatically promoted to Explicit to populate their dashboard immediately.
> **Deduplication Strategy**: We will rely on passing `activeIntents` to the Intent Manager agents (Create/Update/Expire) to handle deduplication natively, rather than a separate deduplication step.

## Proposed Architecture

### 1. Parallel.ai Integration (`lib/parallel/parallel.ts`)
**Role**: Data Acquisition.
-   **API**: `POST https://api.parallel.ai/v1beta/search`
-   **Input**: `objective: "Name, email"`
-   **Output**: Raw scraped data about the user.

### 2. Profile Generator (`agents/profile`) [NEW]
**Role**: The "Builder". Turns raw data into a structured Profile and Bootstrapped Intents.
-   **Input**: Raw text/JSON from Parallel.ai.
-   **Outputs**:
    1.  `UserProfile` (Bio, Skills, structured fields).
    2.  `ImplicitIntents[]` (Derived desires).
-   **Logic**:
    -   Synthesize bio.
    -   Infer top N implicit intents.
    -   **Bootstrap**: Mark top N as `Explicit` immediately.

### 3. Intent Manager (Orchestrator)
**Role**: Coordinates the inference workflow.
-   **Input**: `User Content`, `UserProfile`, `ActiveIntents`.
-   **Deduplication**: The LLM Agents (Explicit/Implicit) receive `activeIntents` in their context and are instructed to `Update` existing intents or `Expire` old ones rather than creating duplicates.

### 4. Opportunity Finder (The "Matchmaker")
-   **Goal**: Connect users based on Profile compatibility.
-   **Process**:
    1.  `match_profiles(userA, candidates)` -> Returns high-relevancy pairs.
    2.  For each pair:
        -   Extract/Create specific `Intents` that represent *why* they matched.
        -   Create a `Stake` linking those intents.

## Execution Plan

### Phase 1: Parallel & Profile Foundation
- [ ] **Parallel Lib**: Implement `parallel.ts` to call the search API.
- [ ] **Profile Agent**: Create `agents/profile/generator.ts` to synthesize `UserProfile` and initial `Intents` from raw data.
- [ ] **Bootstrapping**: Implement logic to save the top N intents as Explicit.

### Phase 2: Intent Manager Refactor
- [ ] **Context Awareness**: Update `ExplicitInferrer` and `IntentManager` to accept `activeIntents`.
- [ ] **Lifecycle**: Implement `Create/Update/Expire` logic in the prompt to handle deduplication.

### Phase 3: Opportunity Finder (Profile-Based)
- [ ] **Profile Matcher**: Implement `find_relevant_profiles(user_profile)` using semantic search/LLM.
- [ ] **Staking**: Implement `stake(intent_a, intent_b)`.

## Verification Plan

### Automated Tests
-   **DB Seed**: Update `src/cli/db-seed.ts` to include `UserProfile` generation for test users.
-   **Profile Generation**:
    1.  Mock Parallel API response (JSON).
    2.  Run `ProfileGenerator`.
    3.  Assert `UserProfile` is created.
    4.  Assert N intents are created and marked Explicit.
-   **Deduplication**:
    1.  Given `ActiveIntents: ["Hiring Rust Dev"]`.
    2.  Input: "I need a Rust engineer."
    3.  Assert: Result is `Update` or `No Action`, NOT `Create`.
