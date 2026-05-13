/**
 * Composition root: wires concrete adapters/services into ProtocolDeps.
 *
 * This file lives OUTSIDE the protocol library (`src/lib/protocol/`) and is
 * the only place that bridges between concrete implementations and the
 * protocol layer's interface-based dependencies.
 *
 * Usage:
 *   const deps = createDefaultProtocolDeps();
 *   new ChatGraphFactory(db, embedder, scraper, chatSession, deps);
 */

import { cacheAdapter, hydeCacheAdapter } from "./adapters/cache.adapter";
import { agentDatabaseAdapter } from './adapters/agent.database.adapter';
import { ComposioIntegrationAdapter } from "./adapters/integration.adapter";
import {
  chatDatabaseAdapter,
  conversationDatabaseAdapter,
  ChatDatabaseAdapter,
  createUserDatabase,
  createSystemDatabase,
} from "./adapters/database.adapter";
import { embedderAdapter } from "./adapters/embedder.adapter";
import { scraperAdapter } from "./adapters/scraper.adapter";
import { intentQueue } from "./queues/intent.queue";
import { opportunityQueue } from "./queues/opportunity.queue";
import { chatSessionAdapter } from './adapters/chat-session.adapter';
import { enricherAdapter } from './adapters/enricher.adapter';
import { agentService } from "./services/agent.service";
import { AgentDispatcherImpl } from './services/agent-dispatcher.service';
import { contactService } from "./services/contact.service";
import { IntegrationService } from "./services/integration.service";
import { opportunityDeliveryService } from "./services/opportunity-delivery.service";
import { negotiationTimeoutQueue } from "./queues/negotiation-timeout.queue";
import { signConnectToken } from "./services/connect-token.service";
import { mintConnectLink as mintConnectLinkSvc, buildConnectShortUrl } from "./services/connect-link.service";
import type { MintConnectLink, ProtocolDeps } from '@indexnetwork/protocol';

/**
 * Create the default ProtocolDeps wired to concrete adapters/services.
 *
 * @returns All protocol-level dependencies using the application's concrete implementations.
 */
export function createDefaultProtocolDeps(): ProtocolDeps {
  const integration = new ComposioIntegrationAdapter();
  const integrationService = new IntegrationService(integration, contactService);
  const agentDispatcher = new AgentDispatcherImpl(agentService, negotiationTimeoutQueue);
  // Public origin used to build short connect-links. Production must set one
  // of BASE_URL / API_BASE_URL / APP_URL; the localhost fallback is dev-only
  // and matches the documented default in backend/.env.example.
  const apiBaseUrl = (
    process.env.BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.APP_URL ||
    'http://localhost:3001'
  ).replace(/\/+$/, '');
  const mintConnectLink: MintConnectLink = async ({ userId, opportunityId, kind, greeting }) => {
    const { code } = await mintConnectLinkSvc({ userId, opportunityId, kind, greeting });
    return { url: buildConnectShortUrl(apiBaseUrl, code) };
  };
  return {
    database: chatDatabaseAdapter,
    embedder: embedderAdapter,
    scraper: scraperAdapter,
    cache: cacheAdapter,
    hydeCache: hydeCacheAdapter,
    integration,
    intentQueue,
    contactService,
    chatSession: chatSessionAdapter,
    enricher: enricherAdapter,
    negotiationDatabase: conversationDatabaseAdapter,
    integrationImporter: integrationService,
    createUserDatabase: (db, userId) =>
      createUserDatabase(db as ChatDatabaseAdapter, userId),
    createSystemDatabase: (db, userId, scope, emb) =>
      createSystemDatabase(db as ChatDatabaseAdapter, userId, scope, emb),
    agentDatabase: agentDatabaseAdapter,
    grantDefaultSystemPermissions: (userId: string) =>
      agentService.grantDefaultSystemPermissions(userId),
    agentDispatcher,
    deliveryLedger: opportunityDeliveryService,
    negotiationTimeoutQueue,
    queueNegotiateExisting: (opportunityId, userId) =>
      opportunityQueue.addNegotiateJob({ opportunityId, userId }),
    mintConnectToken: signConnectToken,
    mintConnectLink,
    frontendUrl: process.env.FRONTEND_URL ?? 'https://index.network',
    apiBaseUrl,
  };
}
