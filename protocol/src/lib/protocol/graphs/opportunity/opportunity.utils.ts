/**
 * Opportunity graph utilities: HyDE strategy selection and actor role derivation.
 * Used by the opportunity graph to choose which HyDE strategies to run and to map
 * strategy matches to the new opportunity actor roles (agent / patient / peer).
 */

import type { HydeStrategy } from '../../agents/hyde/hyde.strategies';

/** Context for selecting HyDE strategies (intent category, index, etc.). */
export interface OpportunityStrategyContext {
  category?: string;
  indexId?: string;
  customPrompt?: string;
}

/**
 * Choose which HyDE strategies to run for a given intent and context.
 * Core strategies (mirror, reciprocal) are always included when searching for opportunities.
 * Category-specific strategies can be added based on intent content or explicit category.
 *
 * @param intent - Intent payload or summary text (used for optional category inference)
 * @param context - Optional context (category, indexId)
 * @returns Array of HyDE strategy names to run
 */
export function selectStrategies(
  intent: string,
  context?: OpportunityStrategyContext
): HydeStrategy[] {
  const base: HydeStrategy[] = ['mirror', 'reciprocal'];

  const category = (context?.category ?? '').toLowerCase();
  const intentLower = intent.toLowerCase();

  // Add category/context-specific strategies
  if (
    category.includes('mentor') ||
    category.includes('guidance') ||
    intentLower.includes('mentor') ||
    intentLower.includes('learn from')
  ) {
    base.push('mentor');
  }
  if (
    category.includes('invest') ||
    category.includes('funding') ||
    intentLower.includes('investor') ||
    intentLower.includes('raise')
  ) {
    base.push('investor');
  }
  if (
    category.includes('collaborat') ||
    category.includes('peer') ||
    intentLower.includes('co-founder') ||
    intentLower.includes('partner')
  ) {
    base.push('collaborator');
  }
  if (
    category.includes('hire') ||
    category.includes('job') ||
    intentLower.includes('hiring') ||
    intentLower.includes('looking for')
  ) {
    base.push('hiree');
  }

  return [...new Set(base)];
}

/** Actor roles in the new opportunity model (agent / patient / peer). */
export type OpportunityActorRole = 'agent' | 'patient' | 'peer';

/** Result of mapping a strategy to source and candidate roles. */
export interface DerivedRoles {
  sourceRole: OpportunityActorRole;
  candidateRole: OpportunityActorRole;
}

/**
 * Map a HyDE strategy to the semantic roles of source and candidate in the opportunity.
 * - agent: can do something for the other (e.g. mentor, investor, helper).
 * - patient: needs something from the other (e.g. seeking help, seeking funding).
 * - peer: symmetric collaboration.
 *
 * @param strategy - The HyDE strategy that produced the match
 * @returns Roles for the source (intent owner) and the candidate (matched user/intent)
 */
export function deriveRolesFromStrategy(strategy: HydeStrategy): DerivedRoles {
  switch (strategy) {
    case 'mirror':
      // Source seeks someone who can help → source is patient, candidate can help → agent
      return { sourceRole: 'patient', candidateRole: 'agent' };
    case 'reciprocal':
      // Source offers something; candidate needs it → source is agent, candidate is patient
      return { sourceRole: 'agent', candidateRole: 'patient' };
    case 'mentor':
      return { sourceRole: 'patient', candidateRole: 'agent' };
    case 'investor':
      return { sourceRole: 'patient', candidateRole: 'agent' };
    case 'collaborator':
      return { sourceRole: 'peer', candidateRole: 'peer' };
    case 'hiree':
      // Source is hiring → agent; candidate wants the job → patient
      return { sourceRole: 'agent', candidateRole: 'patient' };
    default:
      return { sourceRole: 'peer', candidateRole: 'peer' };
  }
}
