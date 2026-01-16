# Felicity: The Intent Verification Protocol

This module implements a rigorous **Speech Act Theory** pipeline to verify user intent.

Unlike standard NLP tasks which simply extract *topics*, the Felicity Protocol determines the **validity, credibility, and execution status** of an intent. It answers the questions: *"Is this possible? Is it sincere? Did it happen?"*

## 📚 Theory: Speech Act Pipeline

We use the standard computational linguistics progression (Austin/Searle) to filter noise from signal.

| Layer | Folder | Academic Concept | Engineering Role |
| --- | --- | --- | --- |
| **1. Form** | `syntactic/` | **Locutionary Act** | **Hard Filter.** Is the text intelligible, spam-free, and grammatically capable of carrying intent? |
| **2. Meaning** | `semantic/` | **Illocutionary Act** | **Deep Verification.** Checks **Felicity Conditions** (Authority, Sincerity, Clarity) against User Profiles. |
| **3. Reality** | `pragmatic/` | **Perlocutionary Act** | **Discourse Consistency.** Monitors subsequent conversation to verify if the promise was fulfilled, abandoned, or contradicted. |

---

## 🛠️ Components

### 1. Syntactic Validator (The Gatekeeper)

* **Location:** `src/agents/intent/felicity/syntactic/`
* **Model:** `gpt-4o-mini` (Fast/Cheap)
* **Role:** Rejects garbage immediately to save costs.
* **Checks:** Language detection, coherence, and spam filtering.
* **Usage:** Run this on *every* raw user input (Tweet, Message, Note).
* **Integration:** Currently active in `src/routes/discover.ts` (`POST /new`). It validates the `payload` before any processing occurs. Rejects invalid input with `400 Bad Request`.

### 2. Semantic Verifier (The Judge)

* **Location:** `src/agents/intent/felicity/semantic/`
* **Model:** `gpt-4o` (High Intelligence)
* **Role:** Determines if the agents (User or AI) are "Good for it."
* **Checks (Searle's Conditions):**
* **Essential:** Is the statement clear and unambiguous? (Filters out vague "collaboration" fluff).
* **Preparatory (Authority):** Does the User Profile (skills/assets) support the claim? *Crucial for validating AI-generated matches.*
* **Sincerity:** Does the language imply genuine commitment?



### 3. Pragmatic Monitor (The Auditor)

* **Location:** `src/agents/intent/felicity/pragmatic/`
* **Model:** `gpt-4o` (Logic/Deduction)
* **Role:** Verifies "Subsequent Conduct" via Discourse Analysis.
* **Checks:**
* Ingests `Target Intent` + `Subsequent Discourse`.
* Verdicts: `FULFILLED` (Explicit confirmation), `BREACHED` (Timeout/Failure), `CONTRADICTED` (Change of mind), `PENDING`.



---

## 🔄 Integration Workflows

Felicity services two distinct pipelines: **AI-Generated Matches** (Opportunity Finder) and **User-Generated Intents** (Chat).

### Workflow A: Opportunity Evaluation (The "Sanity Check")

*Goal: Prevent the Opportunity Finder from suggesting "hallucinated" matches where users lack the actual skills.*

1. **Generation:** Opportunity Finder uses HyDE/RAG to find a match and **generates** a "Shared Intent" (e.g., *"User A and B should co-found a fintech startup"*).
2. **Validation (Semantic Verifier):**
* The Evaluator **MUST** call `SemanticVerifierAgent` on the generated proposal.
* **Input:** The AI-Generated Intent.
* **Context:** Combined Profiles of User A + User B.
* **Check:** *Preparatory Condition.* Do User A and User B *actually* have the fintech/startup experience required?
* **Result:**
* If `Authority < 50`: **REJECT**. The users lack the skills to execute this opportunity.
* If `Clarity < 50`: **REJECT**. The opportunity is too vague (e.g., "Explore synergies").




3. **Delivery:** Only Felicity-verified opportunities are shown to the user.

### Workflow B: Discourse Monitor (Intent Lifecycle)

*Goal: Clean up the database by expiring abandoned intents.*

1. **Ingestion:** User A chats with User B.
2. **Monitoring (Pragmatic Monitor):**
* **Input:** Active Shared Intent ("Build Fintech App") + Recent Chat Logs.
* **Check:** Are they discussing fintech? Did they say "Let's stop"?
* **Result:**
* If `CONTRADICTED`: **Intent Manager** expires the intent.
* If `FULFILLED`: **Intent Manager** marks as Complete (Success).





---

## 📦 Usage Examples

### 1. Validating an AI Match (Opportunity Finder)

This step is required to filter out generic "fluff" results.

```typescript
import { SemanticVerifierAgent } from "./semantic/semantic-verifier";

// The AI suggests A and B are a match
const generatedIntent = "Collaborate on a Rust-based compiler project.";
const combinedContext = JSON.stringify({ userA: profileA, userB: profileB });

const verifier = new SemanticVerifierAgent();
const check = await verifier.run(generatedIntent, combinedContext);

// 1. Sanity Check: If users don't know Rust, reject the match.
if (check.felicity_scores.authority < 60) {
  console.log("Match Rejected: AI hallucinated a capability users don't have.");
  return; 
}

// 2. Clarity Check: If the intent is "Explore synergies", reject it.
if (check.felicity_scores.clarity < 50) {
  console.log("Match Rejected: Opportunity is too vague.");
  return;
}

// Proceed to show opportunity
return generatedIntent;

```

### 2. Monitoring a Chat (Intent Manager)

```typescript
import { PragmaticMonitorAgent } from "./pragmatic/pragmatic-monitor";

// Run periodically on active conversations
const monitor = new PragmaticMonitorAgent();
const audit = await monitor.run(
  activeIntent.description, 
  recentChatLogs // String of last 50 messages
);

if (audit.status === "CONTRADICTED") {
  intentManager.expire(activeIntent.id, "User changed mind");
} else if (audit.status === "FULFILLED") {
  intentManager.complete(activeIntent.id, "Verified by chat logs");
}

```