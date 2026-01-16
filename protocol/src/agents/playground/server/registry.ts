import { IntroGenerator } from '../../intent/stake/intro/intro.generator';
import { SynthesisGenerator } from '../../intent/stake/synthesis/synthesis.generator';
import { ExplicitIntentInferrer } from '../../intent/inferrer/explicit/explicit.inferrer';
import { ImplicitInferrer } from '../../intent/inferrer/implicit/implicit.inferrer';
import { IntentManager } from '../../intent/manager/intent.manager';
import { StakeEvaluator } from '../../intent/stake/evaluator/stake.evaluator';
import { OpportunityEvaluator } from '../../opportunity/opportunity.evaluator';
import { ProfileGenerator } from '../../profile/profile.generator';
import { HydeGeneratorAgent } from '../../profile/hyde/hyde.generator';
import { stakeService } from '../../../services/stake.service';

import { searchUser } from '../../../lib/parallel/parallel';
import { json2md } from '../../../lib/json2md/json2md';
import { IndexEmbedder } from '../../../lib/embedder';
// Shared Embedder Instance (for default usage)
// This embedder is used for generation only (ProfileGenerator, HydeGenerator).
// Search capability is now handled per-agent or via memory searcher.
const sharedEmbedder = new IndexEmbedder();

import { memorySearcher } from '../../../lib/embedder/searchers/memory.searcher';

// Schema Definitions
export type AgentFieldType = 'string' | 'number' | 'boolean' | 'profile' | 'profile_array' | 'string_array' | 'hyde' | 'json';

export interface AgentField {
  key: string; // Supports dot notation for nesting, e.g. "options.minScore"
  label: string;
  type: AgentFieldType;
  description?: string;
  defaultValue?: any;
}

// Registry type definition
type AgentRegistryItem = {
  id: string;
  name: string;
  description: string;
  category: 'intent' | 'opportunity' | 'profile' | 'external' | 'intent_stakes' | 'felicity';
  // 'inputType' is still useful for the "Raw" view default or legacy logic
  inputType: 'profile' | 'raw_text' | 'parallel_params' | 'intent_pairs' | 'context' | 'any';
  defaultInput?: any;
  fields?: AgentField[]; // NEW: Structured Schema
  agentClass?: new (options?: any) => any; // Optional for tool-only items
  // Custom runner to handle different method signatures
  runner?: (agent: any, input: any) => Promise<any>;
  disabled?: boolean;
};

// The Registry
const REGISTRY: AgentRegistryItem[] = [
  // --- External Tools ---
  {
    id: 'parallel-fetcher',
    name: 'Parallel Fetcher',
    description: 'Fetches raw user data from Parallel.ai.',
    category: 'external',
    inputType: 'any',
    defaultInput: {
      name: "Seren Sandikci",
      email: "seren@index.network",
      linkedin: "https://linkedin.com/in/seren",
      websites: ["https://index.network"]
    },
    runner: async (_, input) => {
      console.log('Parallel Fetcher input:', input);

      // Unwrap nested 'input' property if present (playground UI wrapping)
      const actualInput = input?.input ?? input;

      // 1. Objective Strategy
      if (typeof actualInput === 'string') {
        return searchUser({ objective: actualInput });
      }

      if (actualInput.objective && actualInput.objective.trim().length > 0) {
        return searchUser({ objective: actualInput.objective });
      }

      // 2. Struct Strategy - Extract ONLY struct fields (exclude objective)
      const { objective, ...structFields } = actualInput;
      return searchUser(structFields);
    }
  },

  // --- Intent Agents ---
  {
    id: 'intent-manager',
    name: 'Intent Manager',
    description: 'Reconciles new intents with active intents (Create, Update, Expire).',
    category: 'intent',
    inputType: 'any',
    defaultInput: {
      content: "Actually, I'm more interested in investment opportunities now.",
      profile: { identity: { name: "Alice" } },
      activeIntents: [
        { id: "1", description: "Find technical co-founder", status: "active", created_at: 123456789 }
      ]
    },
    agentClass: IntentManager,
    fields: [
      { key: 'content', label: 'Content', type: 'string', description: 'New text input from user' },
      { key: 'profile', label: 'Profile', type: 'profile', description: 'User memory profile for context' },
      { key: 'activeIntents', label: 'Active Intents', type: 'json', description: 'Current intents to reconcile against' }
    ],
    runner: (agent, input) => {
      // Profile and activeIntents are passed through as-is
      // User converts to markdown manually via JSON→MD button in UI
      const profileContext = input.profile || '';
      const activeIntentsContext = input.activeIntents || 'No active intents.';

      return agent.processIntent(input.content, profileContext, activeIntentsContext);
    }
  },
  {
    id: 'explicit-intent-detector',
    name: 'Explicit Intent Inferrer',
    description: 'Extracts structured intents from raw text.',
    category: 'intent',
    inputType: 'any',
    disabled: false,
    defaultInput: {
      content: "I want to meet people building in the decentralized AI space, specifically looking for co-founders.",
      profile: { identity: { name: "Alice" } }
    },
    agentClass: ExplicitIntentInferrer,
    fields: [
      { key: 'content', label: 'Content', type: 'string', description: 'Raw text content' },
      { key: 'profile', label: 'Profile', type: 'profile', description: 'User profile context' }
    ],
    runner: (agent, input) => {
      // Profile is passed through as-is
      // User converts to markdown manually via JSON→MD button in UI
      const profileContext = input.profile || '';

      return agent.run(input.content, profileContext);
    }
  },
  {
    id: 'implicit-inferrer',
    name: 'Implicit Intent Inferrer',
    description: 'Infers underlying goals from profile + opportunity context.',
    category: 'intent',
    inputType: 'any',
    disabled: false,
    defaultInput: {
      profile: { identity: { name: "Alice", bio: "Building autonomous agents." }, attributes: { interests: ["AI", "Crypto"] } },
      opportunityContext: "Just attended ETHDenver and met several protocol developers."
    },
    fields: [
      { key: 'profile', label: 'User Profile', type: 'profile', description: 'User Profile Context' },
      { key: 'opportunityContext', label: 'Opportunity Context', type: 'string', description: 'Context of the specific opportunity match' }
    ],
    agentClass: ImplicitInferrer,
    runner: (agent, input) => agent.run(input.profile, input.opportunityContext)
  },

  // --- Intent Stakes Agents ---
  {
    id: 'intro-generator',
    name: 'Intro Generator',
    description: 'Generates warm introduction synthesis for connecting two users.',
    category: 'intent_stakes',
    inputType: 'any', // Complex object
    disabled: false,
    defaultInput: {
      sender: { name: "Alice", reasonings: ["Expert in AI agents"] },
      recipient: { name: "Bob", reasonings: ["Building a decentralized protocol"] }
    },
    agentClass: IntroGenerator,
    runner: (agent, input) => agent.run(input)
  },
  {
    id: 'synthesis-generator',
    name: 'Synthesis Generator',
    description: 'Generates the "Vibe Check" text explaining why a match exists.',
    category: 'intent_stakes',
    inputType: 'intent_pairs',
    disabled: false,
    defaultInput: {
      source: { name: "Alice", bio: "AI Engineer" },
      target: { name: "Bob", bio: "Protocol Designer" },
      intents: ["Collaboration on Agent Standards"]
    },
    agentClass: SynthesisGenerator,
    runner: (agent, input) => agent.run(input)
  },
  {
    id: 'stake-evaluator',
    name: 'Stake Evaluator',
    description: 'Determines if two intents have mutual relevance.',
    category: 'intent_stakes',
    inputType: 'any',
    disabled: false,
    defaultInput: {
      primaryIntent: { description: "Looking for DeFi projects to invest in." },
      candidates: [
        { intent: { description: "Raising seed round for DeFi protocol." } },
        { intent: { description: "Looking for a job." } }
      ]
    },
    agentClass: StakeEvaluator,
    runner: (agent, input) => agent.run(input.primaryIntent, input.candidates)
  },

  // --- Opportunity Agents ---
  {
    id: 'opportunity-evaluator',
    name: 'Opportunity Evaluator',
    description: 'Finds high-value connections between users (Whole Profile vs Whole Profile).',
    category: 'opportunity',
    inputType: 'any',
    defaultInput: {
      sourceProfile: { identity: { name: "Alice", bio: "AI Researcher" }, attributes: { interests: ["AI", "Math"] } },
      options: {
        minScore: 60,
        hydeDescription: "I am looking for a crypto-native founder who needs help with AI agent architecture. Ideally someone who has raised seed funding and is building on Ethereum."
      }
    },
    fields: [
      { key: 'sourceProfile', label: 'Source Profile', type: 'profile', description: 'The user looking for opportunities.' },
      // Removed manual candidates input - now auto-retrieved via Embedder (Memory Mode from Context)
      { key: 'options.minScore', label: 'Minimum Score', type: 'number', defaultValue: 60 },
      { key: 'options.hydeDescription', label: 'HyDE Description', type: 'hyde', description: 'The hypothetical ideal match description.' },
      { key: 'options.existingOpportunities', label: 'Existing Opportunities', type: 'string', description: 'Context of previous matches to avoid duplicates.' }
    ],
    agentClass: OpportunityEvaluator,
    runner: async (agent, input) => {
      // 0. Auto-Fetch Existing Opportunities if userId is present and field is empty
      const isUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

      if (!input.options?.existingOpportunities && input.sourceProfile?.userId) {
        if (isUUID(input.sourceProfile.userId)) {
          try {
            const existingStakes = await stakeService.getUserStakes(input.sourceProfile.userId, 20);
            if (existingStakes.length > 0) {
              const ctx = existingStakes
                .map(s => `- Match with ${s.candidateName} (ID: ${s.candidateId}) (Score: ${s.score}): ${s.reason}`)
                .join('\n');

              if (!input.options) input.options = {};
              input.options.existingOpportunities = ctx;
              console.log(`[Registry] Auto-fetched ${existingStakes.length} existing opportunities for ${input.sourceProfile.userId}`);
            }
          } catch (e) {
            console.error("[Registry] Failed to fetch existing stakes in playground:", e);
          }
        } else {
          console.log(`[Registry] Skipping existing stakes fetch for non-UUID userId: ${input.sourceProfile.userId}`);
        }
      }

      // 1. Setup Memory Embedder
      // We need an embedder that searches the PASSED candidates (from input.candidates injected by App.tsx)
      const candidates = input.candidates || [];

      const memoryEmbedder = new IndexEmbedder({
        searcher: memorySearcher
      });

      // Inject this new embedder into the agent (or use it directly)
      // Since agent.embedder is private/protected or set in constructor, we might need to rely on 
      // the agent implementation using *an* embedder. 
      // Our 'agent' instance here was created with 'sharedEmbedder' in runAgent(). 
      // But that one is bound to Postgres.

      // HACK: We can just use the memoryEmbedder directly here to do the work, 
      // treating the Agent class mostly for the 'evaluateOpportunities' logic (LLM part).

      // A. Generate Query
      const hydeQuery = input.options?.hydeDescription;
      if (!hydeQuery) {
        throw new Error("HyDE Description is required for Opportunity Evaluation.");
      }
      const queryText = hydeQuery;

      // B. Search using Memory Embedder
      // Use the generated query to search against the passed candidates
      const embeddingResult = await memoryEmbedder.generate(queryText);
      const queryVector = Array.isArray(embeddingResult[0])
        ? (embeddingResult as number[][])[0]
        : (embeddingResult as number[]);

      const searchResults = await memoryEmbedder.search(
        queryVector,
        'profiles', // Collection name irrelevant for memory searcher
        {
          limit: input.options?.limit || 5,
          minScore: (input.options?.minScore || 0) / 100, // Use user input for retrieval threshold (normalized 0-1)
          filter: {
            userId: { ne: input.sourceProfile.userId }
          },
          // CRITICAL: Pass the candidates to the memory searcher options
          candidates: candidates
        }
      );

      const foundCandidates = searchResults.map(r => r.item);

      // C. Evaluate
      const sourceProfileContext = json2md.keyValue({
        bio: input.sourceProfile.identity.bio,
        location: input.sourceProfile.identity.location,
        interests: input.sourceProfile.attributes.interests,
        skills: input.sourceProfile.attributes.skills
      });

      const opportunities = await agent.evaluateOpportunities(sourceProfileContext, foundCandidates, input.options);

      // Return composite debug object
      return opportunities;
    }
  },

  // --- Profile Agents ---
  {
    id: 'profile-generator',
    name: 'Profile Generator',
    description: 'Synthesizes a structured User Memory Profile from raw text/JSON.',
    category: 'profile',
    inputType: 'any', // Supports both FromParallelResult and Raw strategies
    defaultInput: "Yanki is an AI researcher based in SF. He loves building multi-agent systems.",
    // No fields - UI handled directly in App.tsx with mode toggle
    agentClass: ProfileGenerator,
    runner: async (agent, input) => {
      // 1. Handle Parallel Search Response Logic (Mimic ProfileService)
      // Support both raw input (Raw mode) and structured wrapper (Structured mode)
      let rawInput = input;

      // Check if it looks like a Parallel Search Response
      if (typeof rawInput === 'object' && rawInput.results && Array.isArray(rawInput.results)) {
        rawInput = json2md.fromObject(
          rawInput.results.map((r: any) => ({
            title: r.title,
            content: r.excerpts?.join('\n') || ''
          }))
        );
      } else {
        // Fallback for string or other object types
        rawInput = typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
      }

      // 2. Run Agent
      const result = await agent.run(rawInput);

      // 3. Apply Fixed Identity Logic (Mimic ProfileService)
      const fixedIdentity = {
        ...result.profile.identity,
        location: result.profile.identity.location || ''
      };

      // Return the full structure but with fixed identity
      return {
        ...result,
        profile: {
          ...result.profile,
          identity: fixedIdentity
        }
      };
    }
  },
  {
    id: 'hyde-generator',
    name: 'HyDE Generator',
    description: 'Generates a hypothetical ideal candidate description based on a user profile.',
    category: 'profile',
    inputType: 'any', // Takes UserMemoryProfile
    defaultInput: {
      identity: { name: "Yanki", bio: "AI Researcher", location: "SF" },
      narrative: { context: "Building AI agents" },
      attributes: { interests: ["Agents", "Protocols"], skills: ["AI", "TypeScript"], goals: [] }
    },
    // No fields - UI handled directly in App.tsx
    agentClass: HydeGeneratorAgent,
    runner: (agent, input) => {
      // If input has .profile wrapper (from Profile Generator output), unwrap it
      const profile = input.profile || input;
      return agent.generate(profile);
    }
  },
];

export function getAvailableAgents() {
  return REGISTRY.map(({ id, name, description, category, inputType, defaultInput, fields, disabled }) => ({
    id,
    name,
    description,
    category,
    inputType,
    defaultInput,
    fields,
    disabled
  }));
}

export interface RunAgentOptions {
  preProcessors?: {
    embed?: boolean;   // If true, generate embedding for the input
    json2md?: boolean; // If true, convert input to markdown string
  };
}

export async function runAgent(agentId: string, input: any, options?: RunAgentOptions) {
  const item = REGISTRY.find(a => a.id === agentId);
  if (!item) {
    throw new Error(`Agent ${agentId} not found in registry.`);
  }

  // --- PRE-PROCESSORS ---
  let finalInput = input;

  // 1. Embedding pre-processor
  if (options?.preProcessors?.embed) {
    // Only fetch if input is object (Profile-like) or string
    // If it's a string, we might just embedding it directly?
    // For now, assume Profile Object pattern which is the main use case
    if (typeof finalInput === 'object' && finalInput !== null) {
      // Validate common profile fields to verify it's valid for embedding
      const hasContent = finalInput.identity?.bio || finalInput.identity?.name || finalInput.content;

      if (hasContent) {
        // Construct text to embed
        // Fallback: If it has 'content' field (ExplicitIntent), use that.
        // Else if it looks like a profile, construct profile text.
        let textToEmbed = "";

        if (typeof finalInput.content === 'string') {
          textToEmbed = finalInput.content;
        } else {
          // Helper to construct profile text (duplicated from queue for now, or use common?)
          // Inline simple construction
          const parts = [
            finalInput.identity?.bio,
            finalInput.identity?.location,

            finalInput.narrative?.context,
            ...(finalInput.attributes?.interests || []),
            ...(finalInput.attributes?.skills || [])
          ];
          textToEmbed = parts.filter(Boolean).join(' ');
        }

        if (textToEmbed) {
          const embedding = await sharedEmbedder.generate(textToEmbed);
          // Attach embedding to input
          finalInput = {
            ...finalInput,
            embedding: Array.isArray(embedding[0]) ? embedding[0] : embedding
          };
        }
      }
    }
  }

  // 2. Json2MD pre-processor
  if (options?.preProcessors?.json2md) {
    // If input is already string, skip
    if (typeof finalInput !== 'string') {
      // If input has 'profile' wrapper, unwrap it for formatting?
      // Or just format the whole object?
      // Agents usually expect specific keys if they are consuming the string, 
      // but the Refactor made them accept "profileContext" string.
      // So we should format the relevant part.

      // Strategy: 
      // If input has `identity` (UserMemoryProfile), format the whole thing.
      // If input has `profile` property (IntentManager wrapper), format that property?
      // Actually, IntentManager expects `profileContext` string argument if we changed the signature?
      // Wait, IntentManager.processIntent(content, profileContext, activeIntents).
      // If we pass a single string to agent.run(), we assume the agent handles one argument?

      // Let's look at `runner` implementations.

      // ExplicitInferrer: runner: (agent, input) => agent.run(input.content, input.profile)
      // This runner DESTRUCTURES input. 
      // If we convert `input` to a string, this runner FAILs.

      // CRITICAL: Pre-processors should apply to the arguments *expected* by the Runner.
      // BUT `runAgent` is generic.

      // We must handle specific Agent quirks OR make the Agent accept the result of the pre-processor.
      // Since we just refactored Agents to take Strings, checking specific agents:

      // HydeGenerator: runner: agent.generate(input.profile || input)
      // If we use json2md, `finalInput` becomes a string. 
      // `agent.generate(string)` -> Valid!

      // ExplicitIntent (ExplicitIntentDetector): 
      // runner: (agent, input) => agent.run(input.content, input.profile)
      // If we convert input to markdown, we lose `content` vs `profile` separation.
      // ISSUE: ExplicitIntent needs 2 args: content (string) and profile (context string).
      // Pre-processor `json2md` usually implies "Context Object -> Context String".

      // FOR NOW: Let's apply `json2md` to formatted profile objects. 
      // If the agent requires complex arguments (like ExplicitIntent), we might need to apply it specifically.
      // However, for the initial refactor, let's assume `json2md` converts the *Context* object.

      // If `ExplicitIntentInferrer`, we likely only want to format the `profile` part.
      // But `runAgent` doesn't know structure.

      // COMPROMISE:
      // If input is a complex object with `profile`, and we requested json2md:
      // We transform `input.profile` -> string.
      // Effectively "Smart" json2md.

      if (finalInput && typeof finalInput === 'object') {
        if (finalInput.profile) {
          finalInput.profile = json2md.fromObject(finalInput.profile);
        } else if (finalInput.identity) {
          // It is the profile itself
          finalInput = json2md.fromObject(finalInput);
        }
      }
    }
  }


  // Instantiate the agent (if class exists)
  // Inject the shared embedder if the agent supports it
  let agent = null;
  if (item.agentClass) {
    if (
      item.agentClass === OpportunityEvaluator ||
      item.agentClass === ProfileGenerator ||
      item.agentClass === HydeGeneratorAgent
    ) {
      agent = new item.agentClass(sharedEmbedder);
    } else {
      agent = new item.agentClass();
    }
  }

  // Use custom runner if defined
  if (item.runner) {
    return await item.runner(agent, finalInput);
  } else {
    // Default fallback
    if (!agent || typeof agent.run !== 'function') {
      throw new Error(`Agent ${agentId} does not have a .run() method.`);
    }
    return await agent.run(finalInput);
  }
}
