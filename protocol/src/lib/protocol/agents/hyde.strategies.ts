/**
 * HyDE (Hypothetical Document Embeddings) strategy definitions.
 * Each strategy defines how to generate a hypothetical document in the target corpus voice
 * for cross-voice retrieval (e.g. intent → profile, intent → intent).
 */

export type HydeStrategy =
  | 'mirror'      // Intent → Profile (who can help me?)
  | 'reciprocal'  // Intent → Intent (who needs what I offer?)
  | 'mentor'      // Intent → Profile (who can guide me?)
  | 'investor'    // Intent → Profile (who would fund this?)
  | 'collaborator' // Intent → Intent (who shares my interests?)
  | 'hiree';      // Intent → Intent (who wants this job?)

export type HydeTargetCorpus = 'profiles' | 'intents';

export interface HydeContext {
  category?: string;
  indexId?: string;
  customPrompt?: string;
}

export interface HydeStrategyConfig {
  targetCorpus: HydeTargetCorpus;
  prompt: (source: string, context?: HydeContext) => string;
  persist: boolean;
  cacheTTL?: number;
}

export const HYDE_STRATEGIES: Record<HydeStrategy, HydeStrategyConfig> = {
  // ─────────────────────────────────────────────────────────────────────────
  // CORE STRATEGIES (Pre-computed at intent creation, persisted to DB)
  // ─────────────────────────────────────────────────────────────────────────

  mirror: {
    targetCorpus: 'profiles',
    prompt: (intent) => `
      Write a professional biography for the ideal person who can satisfy this goal:
      "${intent}"

      Include their expertise, experience, and what they're currently focused on.
      Write in first person as if they are describing themselves.
    `,
    persist: true,
  },

  reciprocal: {
    targetCorpus: 'intents',
    prompt: (intent) => `
      Write a goal or aspiration statement for someone who is looking for exactly
      what this person offers or needs:
      "${intent}"

      Write from the first person perspective as if stating their own goal.
    `,
    persist: true,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CATEGORY STRATEGIES (Generated on-demand, cached in Redis)
  // ─────────────────────────────────────────────────────────────────────────

  mentor: {
    targetCorpus: 'profiles',
    prompt: (intent) => `
      Write a mentor profile for someone who could guide a person with this goal:
      "${intent}"

      Describe their background, what they've achieved, and how they help others.
      Write in first person.
    `,
    persist: false,
    cacheTTL: 3600, // 1 hour
  },

  investor: {
    targetCorpus: 'profiles',
    prompt: (intent) => `
      Write an investor thesis for someone who would be interested in funding:
      "${intent}"

      Include their investment focus, stage preference, and what they look for.
      Write in first person.
    `,
    persist: false,
    cacheTTL: 3600,
  },

  collaborator: {
    targetCorpus: 'intents',
    prompt: (intent) => `
      Write a collaboration-seeking statement for someone who would be a great
      peer partner for this person:
      "${intent}"

      Focus on complementary skills and shared interests.
      Write in first person.
    `,
    persist: false,
    cacheTTL: 3600,
  },

  hiree: {
    targetCorpus: 'intents',
    prompt: (intent) => `
      Write a job-seeking statement for someone who would be perfect for:
      "${intent}"

      Describe what role they're looking for and their relevant experience.
      Write in first person.
    `,
    persist: false,
    cacheTTL: 3600,
  },
};

/** Mapping from strategy to target corpus for search. Used by embedder adapter. */
export const HYDE_STRATEGY_TARGET_CORPUS: Record<HydeStrategy, HydeTargetCorpus> =
  Object.fromEntries(
    Object.entries(HYDE_STRATEGIES).map(([k, v]) => [k, v.targetCorpus])
  ) as Record<HydeStrategy, HydeTargetCorpus>;
