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
You are an intelligent Routing Agent for Index Network, a professional networking platform.

Your job is to analyze user messages and route them to the correct processing action. Think through your decision systematically.

---

## AVAILABLE ACTIONS

### intent_query
**Type:** Read-only

**What it does:** Fetches and displays the user's existing intents (goals, wants, needs) from the database.

**When to use:**
- User asks to SEE/VIEW/SHOW/LIST their intents
- User asks "what are my intents/goals?"
- User wants to review what they've previously stated

**Examples:** "show my intents", "what goals do I have?", "list my active intents"

**Config:** operationType: "read", extractedContext: null

---

### intent_write
**Type:** Write (create/update/delete)

**What it does:** Processes user statements to CREATE new intents, UPDATE existing intents, or DELETE/EXPIRE intents. Infers intents from natural language, verifies quality, reconciles against existing intents.

**When to use:**
- CREATE: User expresses a new want/need/goal/interest
- UPDATE: User modifies existing intent ("change that to...")
- DELETE: User wants to remove an intent

**Examples:**
- "I want to learn Rust" → create
- "I'm looking for a co-founder" → create
- "change that to Python instead" → update
- "delete my coding goal" → delete
- "yes, create it" (after suggestion) → create

**Config:** operationType: "create" | "update" | "delete", extractedContext: The intent content to process

---

### profile_query
**Type:** Read-only

**What it does:** Fetches and displays the user's profile (name, bio, skills, interests, location) from the database.

**When to use:**
- User asks to SEE/VIEW/SHOW/DISPLAY their profile
- User asks "what's my profile?" or "show my info"
- User asks for profile in any format (table, list, etc.)

**Examples:** "show my profile", "show my profile in a table", "what skills do I have listed?"

**Config:** operationType: "read", extractedContext: null

---

### profile_write
**Type:** Write (create/update)

**What it does:** Creates or updates user profile. Can scrape social profiles (LinkedIn, GitHub, X) for info, generate profile from text input, update specific fields, or create embeddings.

**When to use:**
- User wants to create/update their profile
- User provides info about themselves
- User wants to add skills/interests
- User confirms profile creation after being asked

**Examples:**
- "create my profile" → create
- "add Python to my skills" → update
- "update my bio to..." → update
- "yes, set up my profile" (confirmation) → create/update

**Config:** operationType: "create" | "update", extractedContext: The profile content/updates to process

---

### opportunity_subgraph
**Type:** Discovery

**What it does:** Searches for and evaluates potential connections/matches based on user's profile and intents.

**When to use:**
- User wants to find people/opportunities
- User asks for recommendations or matches
- User wants to discover relevant connections

**Examples:** "find people interested in AI", "who might be a good co-founder?", "show me relevant connections"

**Config:** operationType: null, extractedContext: Search criteria or query

---

### scrape_web
**Type:** Data extraction

**What it does:** Extracts content from a URL (articles, profiles, docs). The scraped content can then be used for other operations.

**When to use:**
- User provides a URL to read/analyze
- User asks to retry a previous failed scrape
- User wants info extracted from a webpage

**Examples:** "read this: https://...", "try again" (after failed scrape)

**Config:** operationType: null, extractedContext: The URL to scrape (REQUIRED)

---

### respond
**Type:** Conversational

**What it does:** Generates a direct conversational response without invoking any subgraph processing.

**When to use:**
- Greetings and general conversation
- Questions ABOUT the platform ("what can you do?")
- Chit-chat that doesn't require data operations

**NEVER use for:** "show me X" → use *_query routes, "create X" → use *_write routes

**Examples:** "hello", "how does this platform work?", "thanks!"

**Config:** operationType: null, extractedContext: null

---

### clarify
**Type:** Disambiguation

**What it does:** Asks the user for clarification when the request is ambiguous or unclear.

**When to use:**
- Message is genuinely ambiguous
- Multiple interpretations are equally likely
- Missing critical information needed to proceed

**Avoid if:** Conversation context makes intent clear, user is confirming a previous suggestion, intent is reasonably inferrable

**Config:** operationType: null, extractedContext: null

---

## THINKING INSTRUCTIONS

Before routing, consider:

1. **ANALYZE THE MESSAGE** - What is the user asking for? READ or WRITE? Any URLs?

2. **CHECK CONVERSATION CONTEXT** - Is this a confirmation ("yes", "sure")? A retry ("try again")? What was previously suggested?

3. **DETECT ANAPHORIC REFERENCES** - "that intent", "change it", "make it..." → refers to existing data, likely UPDATE

4. **DETERMINE OPERATION TYPE** - READ (view/show), CREATE (new), UPDATE (modify), DELETE (remove)

5. **SET CONFIDENCE** - 0.9-1.0: clear, 0.7-0.9: minor ambiguity, 0.5-0.7: best guess, <0.5: consider clarify

---

## CRITICAL RULES

1. **CONFIRMATIONS ARE ACTIONS**: "yes"/"sure"/"do it" after a suggestion = EXECUTE that action
2. **RETRIES USE HISTORY**: "try again" = Find the previous action in history and repeat it
3. **VIEW ≠ RESPOND**: Any "show me X" request goes to *_query, NOT respond
4. **TRUST THE SUBGRAPHS**: Route to actions even if you don't have data - they will fetch it
5. **extractedContext IS CRITICAL**: For write operations, include the FULL content to process
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

/**
 * Schema for each action considered during routing decision.
 * Used for debugging and transparency.
 */
const consideredActionSchema = z.object({
  action: z.string().describe("The action name (e.g., intent_write, profile_query)"),
  score: z.number().min(0).max(1).describe("How well this action matches the request (0.0-1.0)"),
  reason: z.string().describe("Why this action was considered or rejected")
});

const routingResponseSchema = z.object({
  // Thinking/reasoning section for debugging (optional for backward compatibility)
  // Note: nullable() is required for OpenAI structured outputs API compatibility
  thinkingSteps: z.array(z.string()).nullable().optional().describe(
    "Step-by-step reasoning process. Include: 1) What user is asking, 2) Operation type (read/write), 3) Any context from history, 4) Final decision"
  ),
  
  // Actions considered during routing (for debugging, optional for backward compatibility)
  // Note: nullable() is required for OpenAI structured outputs API compatibility
  consideredActions: z.array(consideredActionSchema).nullable().optional().describe(
    "Top 3 actions considered and why. Show your decision-making process."
  ),
  
  // The actual routing decision
  target: z.enum([
    "intent_query",           // Read-only intent queries
    "intent_write",           // Create/update/delete intents
    "intent_subgraph",        // DEPRECATED: Backward compatibility (maps to intent_write)
    "profile_query",          // Read-only profile queries
    "profile_write",          // Update profile
    "profile_subgraph",       // DEPRECATED: Backward compatibility (maps to profile_write)
    "opportunity_subgraph",
    "scrape_web",             // Extract content from URL
    "respond",
    "clarify"
  ]).describe("The selected routing target"),
  
  operationType: z.enum([
    "read",
    "create",
    "update",
    "delete"
  ]).nullable().describe("CRUD operation type. Required for intent_* and profile_* targets, null for others."),
  
  confidence: z.number().min(0).max(1).describe("Confidence in this routing decision (0.0-1.0)"),
  
  reasoning: z.string().describe("One-sentence summary of why this route was chosen"),
  
  extractedContext: z.string().nullable().describe(
    "Content to process: For intent_write, the intent text. For scrape_web, the URL. For updates, the new content."
  )
});

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

export type RouterOutput = z.infer<typeof routingResponseSchema>;
export type RouteTarget = RouterOutput['target'];
export type OperationType = RouterOutput['operationType'];
export type ConsideredAction = z.infer<typeof consideredActionSchema>;

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
    log.info('[RouterAgent.invoke] 🎯 Starting message analysis', {
      userMessage: `"${userMessage}"`,
      messageLength: userMessage.length,
      hasConversationHistory: !!conversationHistory,
      historyLength: conversationHistory?.length || 0,
      hasProfile: !!profileContext,
      hasActiveIntents: !!activeIntents
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
      
      log.info('[RouterAgent.invoke] 📜 Built conversation context for LLM', {
        messageCount: recentMessages.length,
        contextLength: conversationContextText.length,
        contextPreview: conversationContextText.substring(0, 200)
      });
    }

    const prompt = `
${conversationContextText}

**Current User Message**: ${userMessage}

${profileContext ? `\nUser Profile: ${profileContext}` : ''}
${activeIntents ? `\nActive Intents: ${activeIntents}` : ''}

Analyze the conversation and route appropriately.
    `.trim();

    log.info('[RouterAgent.invoke] 📝 Full prompt for router LLM', {
      promptLength: prompt.length,
      hasConversationHistory: conversationContextText.length > 0,
      promptPreview: prompt.substring(0, 300)
    });

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt)
    ];
    
    try {
      const result = await this.model.invoke(messages);
      const output = routingResponseSchema.parse(result);
      
      // Log the full thinking process for debugging
      log.info('[RouterAgent.invoke] 🧠 THINKING STEPS:', {
        steps: output.thinkingSteps
      });
      
      log.info('[RouterAgent.invoke] 🎯 CONSIDERED ACTIONS:', {
        actions: output.consideredActions?.map(a => ({
          action: a.action,
          score: a.score,
          reason: a.reason.substring(0, 100)
        })) || []
      });
      
      log.info('[RouterAgent.invoke] 🤖 LLM routing decision (before safety rules)', {
        target: output.target,
        operationType: output.operationType,
        confidence: output.confidence,
        reasoning: output.reasoning,
        extractedContext: output.extractedContext 
          ? `"${output.extractedContext.substring(0, 150)}..."` 
          : null,
        hasExtractedContext: !!output.extractedContext
      });
      
      // PHASE 1: Apply safety rules to prevent accidental writes
      const safeOutput = this.applySafetyRules(output, userMessage);
      
      const rulesApplied = 
        output.target !== safeOutput.target || 
        output.operationType !== safeOutput.operationType ||
        output.extractedContext !== safeOutput.extractedContext;
      
      log.info('[RouterAgent.invoke] ✅ Final routing decision (after safety rules)', {
        target: safeOutput.target,
        operationType: safeOutput.operationType,
        confidence: safeOutput.confidence,
        reasoning: safeOutput.reasoning,
        extractedContext: safeOutput.extractedContext 
          ? `"${safeOutput.extractedContext.substring(0, 150)}..."` 
          : null,
        hasExtractedContext: !!safeOutput.extractedContext,
        safetyRulesApplied: rulesApplied,
        changes: rulesApplied ? {
          targetChanged: output.target !== safeOutput.target,
          operationTypeChanged: output.operationType !== safeOutput.operationType,
          extractedContextChanged: output.extractedContext !== safeOutput.extractedContext
        } : null
      });
      
      return safeOutput;
    } catch (error: unknown) {
      log.error('[RouterAgent.invoke] ❌ Error during routing', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Default to clarify on error
      return {
        thinkingSteps: ["Error occurred during routing", "Falling back to clarification"],
        consideredActions: [{
          action: "clarify",
          score: 1.0,
          reason: "Error fallback"
        }],
        target: "clarify",
        operationType: null,
        confidence: 0.0,
        reasoning: "Failed to process message, asking for clarification",
        extractedContext: null
      };
    }
  }

  /**
   * Detects if a message is a confirmation response (yes, no, etc.)
   * @param message - The user message to analyze
   * @returns true if confirmation detected
   */
  private isConfirmation(message: string): boolean {
    const lowerMessage = message.toLowerCase().trim();
    
    // Remove punctuation for matching
    const cleaned = lowerMessage.replace(/[.!?]+$/, '');
    
    // Short message check (confirmations are typically ≤10 words)
    const wordCount = cleaned.split(/\s+/).length;
    if (wordCount > 10) {
      return false;
    }
    
    // Affirmative patterns
    const affirmativePatterns = [
      /^(yes|yeah|yep|yup|sure|okay|ok|alright|right|correct|exactly|absolutely|definitely|certainly)$/i,
      /^(that'?s? right|that'?s? correct|sounds good|go ahead|do it|please do|make it so)$/i,
      /^(yes please|yes do it|yes go ahead|sure thing|will do)$/i,
    ];
    
    // Negative patterns
    const negativePatterns = [
      /^(no|nope|nah|never|don'?t|cancel|stop|wait|hold on|not yet|negative)$/i,
      /^(no thanks|not now|maybe later|nevermind)$/i,
    ];
    
    return affirmativePatterns.some(p => p.test(cleaned)) || 
           negativePatterns.some(p => p.test(cleaned));
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
    
    // Rule 2: Only downgrade VERY low confidence writes (< 0.4) to reads
    // Trust the model more - it's smarter than our rules
    if (
      (output.target === 'intent_write' || output.target === 'profile_write') &&
      output.confidence < 0.4
    ) {
      log.warn('[RouterAgent] Very low confidence write operation, considering downgrade', {
        originalTarget: output.target,
        confidence: output.confidence,
        reasoning: output.reasoning
      });
      
      return {
        ...output,
        target: output.target.replace('_write', '_query') as RouteTarget,
        operationType: 'read',
        reasoning: `[SAFETY] Very low confidence (${output.confidence.toFixed(2)}). Original: ${output.reasoning}`
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
    
    // Rule 5: Anaphoric reference detection - upgrade create to update
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
