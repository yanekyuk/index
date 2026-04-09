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

import { RedisCacheAdapter } from "./adapters/cache.adapter";
import { agentDatabaseAdapter } from './adapters/agent.database.adapter';
import { ComposioIntegrationAdapter } from "./adapters/integration.adapter";
import {
  chatDatabaseAdapter,
  conversationDatabaseAdapter,
  ChatDatabaseAdapter,
  createUserDatabase,
  createSystemDatabase,
} from "./adapters/database.adapter";
import { EmbedderAdapter } from "./adapters/embedder.adapter";
import { ScraperAdapter } from "./adapters/scraper.adapter";
import { intentQueue } from "./queues/intent.queue";
import { chatSessionService } from "./services/chat.service";
import { agentService } from "./services/agent.service";
import { AgentDeliveryService } from './services/agent-delivery.service';
import { AgentDispatcherImpl } from './services/agent-dispatcher.service';
import { contactService } from "./services/contact.service";
import { IntegrationService } from "./services/integration.service";
import { enrichUserProfile } from "./lib/parallel/parallel";
import { webhookService } from "./services/webhook.service";
import { WEBHOOK_EVENTS } from "./lib/webhook-events";
import { negotiationTimeoutQueue } from "./queues/negotiation-timeout.queue";
import { webhookQueue } from "./queues/webhook.queue";
import type { ProtocolDeps } from '@indexnetwork/protocol';

/**
 * Create the default ProtocolDeps wired to concrete adapters/services.
 *
 * @returns All protocol-level dependencies using the application's concrete implementations.
 */
export function createDefaultProtocolDeps(): ProtocolDeps {
  const integration = new ComposioIntegrationAdapter();
  const integrationService = new IntegrationService(integration, contactService);
  const agentDeliveryService = new AgentDeliveryService(webhookService, webhookQueue);
  const agentDispatcher = new AgentDispatcherImpl(agentService, agentDeliveryService, negotiationTimeoutQueue);
  const embedder = new EmbedderAdapter();
  const scraper = new ScraperAdapter();

  return {
    database: chatDatabaseAdapter,
    embedder,
    scraper,
    cache: new RedisCacheAdapter(),
    hydeCache: new RedisCacheAdapter(),
    integration,
    intentQueue,
    contactService,
    chatSession: chatSessionService,
    enricher: { enrichUserProfile },
    negotiationDatabase: conversationDatabaseAdapter as unknown as ProtocolDeps['negotiationDatabase'],
    integrationImporter: integrationService,
    createUserDatabase: (db, userId) =>
      createUserDatabase(db as unknown as ChatDatabaseAdapter, userId),
    createSystemDatabase: (db, userId, scope, emb) =>
      createSystemDatabase(db as unknown as ChatDatabaseAdapter, userId, scope, emb),
    webhook: {
      create: (userId: string, url: string, events: string[], description?: string) =>
        webhookService.create(userId, url, events, description),
      list: (userId: string) => webhookService.list(userId),
      delete: (userId: string, webhookId: string) => webhookService.delete(userId, webhookId),
      test: (userId: string, webhookId: string) => webhookService.test(userId, webhookId),
      listEvents: () => [...WEBHOOK_EVENTS],
    },
    agentDatabase: agentDatabaseAdapter as unknown as ProtocolDeps['agentDatabase'],
    grantDefaultSystemPermissions: (userId: string) =>
      agentService.grantDefaultSystemPermissions(userId),
    agentDispatcher,
    negotiationTimeoutQueue,
  };
}
