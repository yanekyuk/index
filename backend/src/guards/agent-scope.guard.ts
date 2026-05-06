import { eq } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { agentPermissions } from '../schemas/database.schema';
import { resolveApiKeyAgentId } from './auth.guard';

/**
 * Resolve the network the current request's agent is restricted to, or null
 * if the request is JWT-authenticated, has no API key, the key carries no
 * `metadata.agentId`, or the agent has any `scope='global'` permission.
 *
 * If the agent has *only* network-scoped permissions, returns the single
 * `scopeId` they share. Throws if the agent's network-scoped permissions
 * disagree on `scopeId` (defensive — should never happen for imported agents).
 *
 * @param req - The incoming request whose `x-api-key` header is inspected
 * @returns The bound network id, or `null` if the agent is not network-scoped
 * @throws If the agent has multiple distinct network scopes
 */
export const resolveAgentNetworkScope = async (req: Request): Promise<string | null> => {
  const agentId = await resolveApiKeyAgentId(req);
  if (!agentId) return null;

  const rows = await db
    .select({ scope: agentPermissions.scope, scopeId: agentPermissions.scopeId })
    .from(agentPermissions)
    .where(eq(agentPermissions.agentId, agentId));

  if (rows.length === 0) return null;
  if (rows.some((r) => r.scope === 'global')) return null;

  const networkScoped = rows.filter((r) => r.scope === 'network' && r.scopeId);
  if (networkScoped.length === 0) return null;

  const distinctIds = new Set(networkScoped.map((r) => r.scopeId!));
  if (distinctIds.size > 1) {
    throw new Error(`Agent ${agentId} has conflicting network scopes: ${[...distinctIds].join(', ')}`);
  }
  return networkScoped[0].scopeId!;
};

/**
 * Assert the current request's agent (if network-scoped) is allowed to act
 * on `networkId`. No-op for JWT-authenticated requests and for global agents.
 *
 * @param req - The incoming request whose agent scope is checked
 * @param networkId - The network the caller intends to act on
 * @throws If the agent is bound to a different network than `networkId`
 */
export const assertAgentNetworkScope = async (req: Request, networkId: string): Promise<void> => {
  const scope = await resolveAgentNetworkScope(req);
  if (scope === null) return;
  if (scope !== networkId) {
    throw new Error(`Agent is restricted to its bound network scope and cannot act on network ${networkId}`);
  }
};
