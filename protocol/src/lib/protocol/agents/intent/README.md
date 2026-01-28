# Intent Agents

This directory contains the core agents responsible for the **Intent Lifecycle**, from extraction to state reconciliation.

## Agents

### 1. Inferrer (`/inferrer`)
**Agent:** `ExplicitIntentInferrer`
- **Purpose:** Extracts raw "Goal" or "Tombstone" intents from user content (e.g., chat messages) and their profile context.
- **Output:** A list of `InferredIntent` objects.

### 2. Verifier (`/verifier`)
**Agent:** `SemanticVerifierAgent`
- **Purpose:** Validates the semantic quality of an intent using **Searle's Felicity Conditions**:
  - **Clarity:** Is the intent specific and actionable?
  - **Authority:** Does the user have the skills/right to perform it?
  - **Sincerity:** Is there genuine commitment?
- **Output:** A verification verdict (`COMMISSIVE`, `DIRECTIVE`, etc.) and felicity scores.

### 3. Reconciler (`/reconciler`)
**Agent:** `IntentReconcilerAgent`
- **Purpose:** The final decision maker. Compares verified "candidate" intents against the user's **Active Intents** to determine the necessary database actions.
- **Actions:**
  - `CREATE`: New valid goal.
  - `UPDATE`: improved description or score.
  - `EXPIRE`: Completed or abandoned goal (Tombstone).
