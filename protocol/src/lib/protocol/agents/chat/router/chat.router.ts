import { ChatOpenAI } from "@langchain/openai";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { log } from "../../../../log";

/**
 * Config
 */
import { config } from "dotenv";
config({ path: '.env.development', override: true });

const model = new ChatOpenAI({
  model: 'google/gemini-2.5-flash',
  configuration: {
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY
  }
});

// ──────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────

const systemPrompt = `
You are a Routing Agent for a professional networking platform.
Your task is to analyze user messages and determine the appropriate action.

## CRITICAL: Confirmation Detection with Conversation Context

**NEW PRIORITY RULE**: When conversation history is provided, FIRST check if the current message is confirming a previously suggested action.

### Confirmation Signals
If the assistant previously suggested an action (e.g., "Should I update your intent to X?"), and the user responds with:
- Affirmative: "yes", "yeah", "yep", "sure", "okay", "ok", "go ahead", "do it", "please", "correct", "right", "exactly"
- Negative: "no", "nope", "don't", "cancel", "nevermind"

Then route based on the SUGGESTED ACTION, not the literal confirmation word.

Examples with context (from conversation history):
- Assistant suggests update + User says "Yes" => intent_write (operationType: update)
- Assistant suggests deletion + User says "Sure, go ahead" => intent_write (operationType: delete)
- Assistant suggests creation + User says "Okay" => intent_write (operationType: create)

**Detection Algorithm**:
1. Check if current message is a short affirmative/negative (≤10 words)
2. Look for confirmation keywords in current message
3. Scan previous assistant message (last 1-2 messages) for action suggestions
4. Extract the suggested action type and subject
5. Route to the appropriate target with the suggested operationType

## CRITICAL: Read vs Write Detection

Before selecting a routing target, first determine the user's INTENT:

### READ Operations (Queries)
Route to *_query targets when the user is:
- **Asking questions** about existing data
- **Requesting information** to be displayed
- **Checking status** of their data

Linguistic Signals for READ:
- Question words: "what", "show", "list", "tell me", "do I have"
- Request verbs: "see", "view", "check", "display", "get"
- Plural references: "my intents", "my goals" (asking about collection)
- Past/present tense: "what are", "what is", "have I"

Examples:
✓ "what are my intents?" → intent_query (operationType: read)
✓ "show me my goals" → intent_query (operationType: read)
✓ "list my current intentions" → intent_query (operationType: read)
✓ "do I have any active goals?" → intent_query (operationType: read)
✓ "what's my profile?" → profile_query (operationType: read)

### WRITE Operations (Assertions/Commands)
Route to *_write targets when the user is:
- **Declaring new information** (commissives)
- **Committing to actions** (declarations)
- **Requesting changes** to existing data
- **Expressing desires** for the future

Linguistic Signals for WRITE:
- Commissive verbs: "I want", "I will", "I'm going to", "I plan to"
- Directive verbs: "add", "create", "update", "change", "delete", "remove"
- Future tense: "I want to learn", "looking for", "interested in"
- Singular declarations: "my goal is", "I need to"

Examples:
✓ "I want to learn Rust" → intent_write (operationType: create)
✓ "looking for a co-founder" → intent_write (operationType: create)
✓ "update my bio to..." → profile_write (operationType: update)
✓ "I'm interested in AI" → intent_write (operationType: create)
✓ "remove my coding goal" → intent_write (operationType: delete)

### UPDATE Operations (Modifications)
Explicitly mentioned changes to existing data or anaphoric references to existing entities:

Direct Update Commands:
✓ "change my goal from X to Y" → intent_write (operationType: update)
✓ "update my learning intent" → intent_write (operationType: update)
✓ "modify my profile bio" → profile_write (operationType: update)

Anaphoric References (referring to previously mentioned entities):
✓ "make that intent more specific" → intent_write (operationType: update)
✓ "add AI to that goal" → intent_write (operationType: update)
✓ "change it to include TypeScript" → intent_write (operationType: update)
✓ "update this one to be text-based" → intent_write (operationType: update)
✓ "make the RPG game text-based" → intent_write (operationType: update)
✓ "refine my previous intent" → intent_write (operationType: update)

Linguistic Signals for Anaphoric Updates:
- Demonstrative pronouns: "that", "this", "these", "those"
- Anaphoric pronouns: "it", "them"
- Definite articles with context: "the intent", "the goal"
- Ordinal references: "my previous", "my last", "my first"
- All combined with modification verbs: "make", "change", "add to", "update", "refine", "modify"

### DELETE Operations (Removal)
Explicit removal or abandonment:
✓ "delete my goal about coding" → intent_write (operationType: delete)
✓ "I'm done with machine learning" → intent_write (operationType: delete)
✓ "remove my intent to travel" → intent_write (operationType: delete)

## Routing Options

1. **intent_query** - READ ONLY: Fetch and display existing intents
   - Use when: User asks questions about their intents
   - operationType: "read"
   
2. **intent_write** - WRITE: Create, update, or delete intents
   - Use when: User expresses new goals, updates, or deletions
   - operationType: "create" | "update" | "delete"

3. **profile_query** - READ ONLY: Display profile information
   - Use when: User asks about their profile
   - operationType: "read"

4. **profile_write** - WRITE: Update profile data
   - Use when: User wants to modify their profile
   - operationType: "update"

5. **opportunity_subgraph** - Discovery and matching
   - Use when: User wants recommendations or connections
   - No operationType needed

6. **respond** - Direct conversational response
   - Use when: General conversation or system questions
   - No operationType needed

7. **clarify** - Ambiguous or unclear
   - Use when: Cannot determine intent
   - No operationType needed

## Decision Algorithm

1. First, detect if message is a QUESTION or ASSERTION
2. If question → check subject matter → route to *_query
3. If assertion → check subject matter → route to *_write
4. Set operationType based on linguistic analysis
5. Provide high confidence (>0.8) for clear read/write distinction

## Output Rules
- Always set operationType for intent_* and profile_* routes
- Default to READ when ambiguous (safer than accidental writes)
- Provide confidence (0.0-1.0) based on signal clarity
- Extract relevant context for write operations only
- Explain reasoning with specific linguistic evidence
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

const routingResponseSchema = z.object({
  target: z.enum([
    "intent_query",           // NEW: Read-only intent queries
    "intent_write",           // NEW: Create/update/delete intents (replaces intent_subgraph)
    "intent_subgraph",        // DEPRECATED: Backward compatibility (maps to intent_write)
    "profile_query",          // NEW: Read-only profile queries
    "profile_write",          // NEW: Update profile (replaces profile_subgraph)
    "profile_subgraph",       // DEPRECATED: Backward compatibility (maps to profile_write)
    "opportunity_subgraph",
    "respond",
    "clarify"
  ]).describe("The routing target"),
  operationType: z.enum([
    "read",
    "create",
    "update",
    "delete"
  ]).nullable().describe("CRUD operation type for intent_* and profile_* routes. Required for intent_* and profile_* targets, null for others."),
  confidence: z.number().min(0).max(1).describe("Confidence in this routing decision (0.0-1.0)"),
  reasoning: z.string().describe("Brief explanation for this routing choice"),
  extractedContext: z.string().nullable().describe("Relevant context extracted from message for subgraph processing")
});

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

export type RouterOutput = z.infer<typeof routingResponseSchema>;
export type RouteTarget = RouterOutput['target'];
export type OperationType = RouterOutput['operationType'];

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

/**
 * RouterAgent analyzes user messages to determine the appropriate routing target.
 * It uses structured output to ensure consistent routing decisions.
 */
export class RouterAgent {
  private model: any;

  constructor() {
    this.model = model.withStructuredOutput(routingResponseSchema, {
      name: "router_agent"
    });
  }

  /**
   * Invokes the router agent to analyze a user message and determine routing.
   * @param userMessage - The user's message to analyze
   * @param profileContext - Formatted string of user profile for context
   * @param activeIntents - Formatted string of user's active intents
   * @param conversationHistory - Optional array of previous messages for context-aware routing
   * @returns RouterOutput with target, confidence, reasoning, and optional extracted context
   */
  public async invoke(
    userMessage: string,
    profileContext: string,
    activeIntents: string,
    conversationHistory?: BaseMessage[]
  ): Promise<RouterOutput> {
    log.info('[RouterAgent.invoke] Analyzing message...', {
      messagePreview: userMessage.substring(0, 50),
      hasConversationHistory: !!conversationHistory,
      historyLength: conversationHistory?.length || 0
    });

    // Build conversation context if available
    let conversationContextText = "";
    if (conversationHistory && conversationHistory.length > 0) {
      // Include last 5 messages for context (prioritize recent exchanges)
      const recentMessages = conversationHistory.slice(-5);
      conversationContextText = "\n# Recent Conversation History\n";
      recentMessages.forEach((msg, index) => {
        const role = msg._getType() === 'human' ? 'User' : 'Assistant';
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        conversationContextText += `${role}: ${content}\n`;
      });
    }

    const prompt = `
# Current User Message
${userMessage}

# User Profile Context
${profileContext || "No profile loaded yet."}

# Active Intents
${activeIntents || "No active intents."}
${conversationContextText}

Analyze this message and determine the best routing action.
**IMPORTANT**: If conversation history shows the assistant suggesting an action and the current message is a confirmation, route to execute that action.
    `.trim();

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt)
    ];
    
    try {
      const result = await this.model.invoke(messages);
      const output = routingResponseSchema.parse(result);
      
      log.info('[RouterAgent.invoke] Initial routing decision', {
        target: output.target,
        operationType: output.operationType,
        confidence: output.confidence
      });
      
      // PHASE 1: Apply safety rules to prevent accidental writes
      const safeOutput = this.applySafetyRules(output, userMessage);
      
      log.info('[RouterAgent.invoke] Final routing decision', {
        target: safeOutput.target,
        operationType: safeOutput.operationType,
        confidence: safeOutput.confidence,
        safetyRulesApplied: output.target !== safeOutput.target || output.operationType !== safeOutput.operationType
      });
      
      return safeOutput;
    } catch (error: unknown) {
      log.error('[RouterAgent.invoke] Error during routing', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Default to clarify on error
      return {
        target: "clarify",
        operationType: null,
        confidence: 0.0,
        reasoning: "Failed to process message, asking for clarification",
        extractedContext: null
      };
    }
  }

  /**
   * Detects anaphoric references in user messages that suggest an update operation.
   * Anaphoric references include: "that intent", "this goal", "the RPG game", etc.
   * @param message - The user message to analyze
   * @returns true if anaphoric reference detected
   */
  private detectAnaphoricReference(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    
    // Demonstrative pronouns + intent/goal keywords
    const demonstrativePatterns = [
      /\b(that|this|these|those)\s+(intent|goal|objective|plan|project|idea)\b/i,
      /\b(the)\s+(intent|goal|objective|plan|project|idea)\b/i,
      /\bmake\s+(that|this|it|them)\b/i,
      /\b(change|update|modify|refine|add to|edit)\s+(that|this|it|them)\b/i,
      /\b(my|the)\s+(previous|last|first|current)\s+(intent|goal)\b/i
    ];
    
    // Check for demonstrative patterns
    const hasDemonstrativePattern = demonstrativePatterns.some(pattern =>
      pattern.test(lowerMessage)
    );
    
    // Modification verbs that often accompany anaphoric references
    const modificationVerbs = /\b(make|change|update|modify|refine|add|edit|adjust)\b/i;
    
    // Anaphoric pronouns (only count if combined with modification verbs)
    const anaphoricPronouns = /\b(it|that|this)\b/i;
    
    return hasDemonstrativePattern ||
           (modificationVerbs.test(lowerMessage) && anaphoricPronouns.test(lowerMessage));
  }

  /**
   * Applies safety rules to routing decisions.
   * Prevents accidental writes when intent is unclear.
   */
  private applySafetyRules(
    output: RouterOutput,
    userMessage: string
  ): RouterOutput {
    // Rule 0: Strong anaphoric reference with action verb → force intent_write update
    // This runs before other rules to catch cases where LLM misroutes anaphoric updates
    if (this.detectAnaphoricReference(userMessage)) {
      // Check if it's combined with an action/modification verb
      const actionVerbs = /\b(make|create|update|change|modify|set|add|remove|delete)\s+(that|this|it|the)\b/i;
      
      if (actionVerbs.test(userMessage)) {
        log.info('[RouterAgent] Strong anaphoric update signal detected, forcing intent_write update', {
          originalTarget: output.target,
          originalOperationType: output.operationType,
          messagePreview: userMessage.substring(0, 50)
        });
        
        return {
          ...output,
          target: 'intent_write',
          operationType: 'update',
          reasoning: `[ANAPHORIC OVERRIDE] Strong update signal detected: "${userMessage.substring(0, 50)}...". ${output.reasoning}`
        };
      }
    }
    
    // Rule 1: Map deprecated targets to new targets for backward compatibility
    if (output.target === 'intent_subgraph') {
      log.warn('[RouterAgent] Deprecated target used: intent_subgraph → intent_write', {
        confidence: output.confidence
      });
      output = {
        ...output,
        target: 'intent_write',
        operationType: output.operationType || 'create'
      };
    }
    
    if (output.target === 'profile_subgraph') {
      log.warn('[RouterAgent] Deprecated target used: profile_subgraph → profile_write', {
        confidence: output.confidence
      });
      output = {
        ...output,
        target: 'profile_write',
        operationType: output.operationType || 'update'
      };
    }
    
    // Rule 2: Low confidence on write operations → downgrade to read
    if (
      (output.target === 'intent_write' || output.target === 'profile_write') &&
      output.confidence < 0.6
    ) {
      log.warn('[RouterAgent] Low confidence write operation downgraded to read', {
        originalTarget: output.target,
        confidence: output.confidence,
        reasoning: output.reasoning
      });
      
      return {
        ...output,
        target: output.target.replace('_write', '_query') as RouteTarget,
        operationType: 'read',
        confidence: output.confidence,
        reasoning: `[SAFETY] Downgraded to read due to low confidence (${output.confidence.toFixed(2)}). Original: ${output.reasoning}`
      };
    }
    
    // Rule 3: Write operation without operationType → infer from target or default to create
    if (
      (output.target === 'intent_write' || output.target === 'profile_write') &&
      !output.operationType
    ) {
      log.warn('[RouterAgent] Write operation missing operationType, defaulting to create', {
        target: output.target
      });
      return {
        ...output,
        operationType: 'create'
      };
    }
    
    // Rule 4: Query target with non-read operationType → ensure operationType is read
    if (
      (output.target === 'intent_query' || output.target === 'profile_query') &&
      output.operationType !== 'read'
    ) {
      log.warn('[RouterAgent] Query target with non-read operationType, correcting', {
        target: output.target,
        originalOperationType: output.operationType
      });
      return {
        ...output,
        operationType: 'read'
      };
    }
    
    // Rule 5: Pattern-based safety check - strong query signals with write target
    const queryPatterns = /\b(what|show|list|view|see|tell me|display|get|do i have)\b/i;
    if (
      (output.target === 'intent_write' || output.target === 'profile_write') &&
      queryPatterns.test(userMessage) &&
      output.confidence < 0.75
    ) {
      log.warn('[RouterAgent] Query pattern detected with write target, downgrading to read', {
        originalTarget: output.target,
        confidence: output.confidence,
        messagePreview: userMessage.substring(0, 50)
      });
      
      return {
        ...output,
        target: output.target.replace('_write', '_query') as RouteTarget,
        operationType: 'read',
        reasoning: `[SAFETY] Query pattern detected with low confidence. Original: ${output.reasoning}`
      };
    }
    
    // Rule 6: Anaphoric reference detection - upgrade create to update
    if (
      output.target === 'intent_write' &&
      output.operationType === 'create' &&
      this.detectAnaphoricReference(userMessage)
    ) {
      log.info('[RouterAgent] Anaphoric reference detected, upgrading create to update', {
        messagePreview: userMessage.substring(0, 50),
        originalOperationType: output.operationType
      });
      
      return {
        ...output,
        operationType: 'update',
        reasoning: `[ANAPHORIC] Reference to existing intent detected. ${output.reasoning}`
      };
    }
    
    return output;
  }
}
