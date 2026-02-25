/**
 * Opportunity graph utilities: HyDE strategy selection and actor role derivation.
 * Used by the opportunity graph to choose which HyDE strategies to run and to map
 * strategy matches to the new opportunity actor roles (agent / patient / peer).
 */

import type { HydeStrategy } from '../agents/hyde.strategies';

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

/**
 * Validates opportunity actors against the introducer rule:
 * - If an opportunity has an introducer, it must have one or two non-introducer actors
 *   (1 = 1:1 intro e.g. "I want to connect with X"; 2 = introducer connecting two others).
 *
 * @param actors - Array of actors with at least a role (e.g. { role: string })
 * @throws Error when the actor set is invalid
 */
export function validateOpportunityActors(actors: Array<{ role: string }>): void {
  const introducerCount = actors.filter((a) => a.role === 'introducer').length;
  const nonIntroducerCount = actors.filter((a) => a.role !== 'introducer').length;

  if (introducerCount > 0 && (nonIntroducerCount < 1 || nonIntroducerCount > 2)) {
    throw new Error(
      'An opportunity with an introducer must have one or two other actors.'
    );
  }
}

/**
 * Role-based visibility (Latent Opportunity Lifecycle).
 * A user can see an opportunity iff they are an actor and the rule below allows it.
 *
 * Compact Visibility Rule (from lifecycle doc):
 * - Introducer or peer: always see.
 * - Patient or party: see if (status is not latent, or there is no introducer).
 * - Agent: see if (status is accepted/rejected/expired, or (status is not latent and there is no introducer)).
 *
 * Note: the Home feed is further gated by `isActionableForViewer` which limits
 * introducer actionability to `latent` only. This function is the broader
 * "can you see this at all" gate — matching the DB adapter's SQL visibility guard.
 */
export function canUserSeeOpportunity(
  actors: Array<{ userId: string; role: string }>,
  status: string,
  userId: string
): boolean {
  const hasIntroducer = actors.some((a) => a.role === 'introducer');
  const userRoles = actors.filter((a) => a.userId === userId).map((a) => a.role);
  if (userRoles.length === 0) return false;

  return userRoles.some((role) => {
    if (role === 'introducer') return true;
    if (role === 'peer') return true;
    if (role === 'patient' || role === 'party')
      return status !== 'latent' || !hasIntroducer;
    if (role === 'agent')
      return (
        ['accepted', 'rejected', 'expired'].includes(status) ||
        (status !== 'latent' && !hasIntroducer)
      );
    return false;
  });
}

/**
 * Whether an opportunity should appear on the Home feed for the viewer (actionable = has a pending action).
 * Encodes the role-visibility matrix from the Latent Opportunity Lifecycle: only show statuses where
 * the viewer's role has an action (Send, Accept/Reject, or transitional "Go to chat").
 */
export function isActionableForViewer(
  actors: Array<{ userId: string; role: string }>,
  status: string,
  viewerId: string
): boolean {
  const viewerActors = actors.filter((a) => a.userId === viewerId);
  if (viewerActors.length === 0) return false;

  const hasIntroducer = actors.some((a) => a.role === 'introducer');

  return viewerActors.some(({ role }) => {
    switch (role) {
      case 'introducer':
        return status === 'latent';
      case 'patient':
      case 'party':
        return hasIntroducer
          ? status === 'pending' || status === 'viewed'
          : status === 'latent';
      case 'agent':
        return hasIntroducer
          ? status === 'accepted'
          : status === 'pending' || status === 'viewed';
      case 'peer':
        return status === 'latent' || status === 'pending' || status === 'viewed';
      default:
        return false;
    }
  });
}
