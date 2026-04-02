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
import { contactService } from "./services/contact.service";
import { IntegrationService } from "./services/integration.service";
import { enrichUserProfile } from "./lib/parallel/parallel";
import type { ProtocolDeps } from "./lib/protocol/tools/tool.helpers";

/**
 * Create the default ProtocolDeps wired to concrete adapters/services.
 *
 * @returns All protocol-level dependencies using the application's concrete implementations.
 */
export function createDefaultProtocolDeps(): ProtocolDeps {
  const integration = new ComposioIntegrationAdapter();
  const integrationService = new IntegrationService(integration);
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
    negotiationDatabase: conversationDatabaseAdapter,
    integrationImporter: integrationService,
    createUserDatabase: (db, userId) =>
      createUserDatabase(db as unknown as ChatDatabaseAdapter, userId),
    createSystemDatabase: (db, userId, scope, emb) =>
      createSystemDatabase(db as unknown as ChatDatabaseAdapter, userId, scope, emb),
  };
}
