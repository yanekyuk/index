import db from '../../lib/drizzle/drizzle';
import { agents } from '../../schemas/database.schema';
import { eq, isNull } from 'drizzle-orm';
import { SemanticRelevancyBroker } from './semantic_relevancy';
import { log } from '../../lib/log';

const logger = log.agent.from('[DEPRECATED] context_brokers/connector');

// Context broker interface
interface ContextBroker {
  readonly agentId: string;
  onIntentCreated: (intentId: string) => Promise<void>;
  onIntentUpdated: (intentId: string, previousStatus?: string) => Promise<void>;
  onIntentArchived: (intentId: string) => Promise<void>;
}

// Map of broker types to their implementations
const BROKER_IMPLEMENTATIONS: Record<string, new (agentId: string) => ContextBroker> = {
  // Semantic relevancy agent
  '028ef80e-9b1c-434b-9296-bb6130509482': SemanticRelevancyBroker,
  // Example context broker
  // '1c6a36bd-ffb5-4f8f-a20a-bc2e1e3fd55b': ExampleContextBroker,
};

// Registry of all available context brokers
let CONTEXT_BROKERS: ContextBroker[] = [];

/**
 * Initialize brokers from database
 * @deprecated
 */
export async function initializeBrokers(): Promise<void> {
  logger.info('📥 Initializing context brokers from database...');
  const activeAgents = await db.select()
    .from(agents)
    .where(isNull(agents.deletedAt));

  CONTEXT_BROKERS = activeAgents
    .map(agent => {
      const BrokerClass = BROKER_IMPLEMENTATIONS[agent.id];
      if (!BrokerClass) {
        console.warn(`⚠️ No implementation found for broker: ${agent.name} (${agent.id})`);
        return null;
      }
      return new BrokerClass(agent.id);
    })
    .filter((broker): broker is ContextBroker => broker !== null);

  logger.info(`✅ Initialized ${CONTEXT_BROKERS.length} context brokers`);
}

/**
 * Trigger all registered context brokers when a new intent is created
 * @deprecated
 */
export async function triggerBrokersOnIntentCreated(intentId: string): Promise<void> {
  logger.info(`🎯 Triggering ${CONTEXT_BROKERS.length} context brokers for new intent: ${intentId}`);

  const brokerPromises = CONTEXT_BROKERS.map(async (broker) => {
    try {
      logger.info(`🚀 Starting broker: ${broker.agentId} for intent: ${intentId}`);
      await broker.onIntentCreated(intentId);
      logger.info(`✅ Broker ${broker.agentId} completed for intent: ${intentId}`);
    } catch (error) {
      logger.error(`❌ Broker ${broker.agentId} failed for intent ${intentId}:`, { error });
    }
  });

  await Promise.allSettled(brokerPromises);
  logger.info(`🏁 All brokers finished processing intent: ${intentId}`);
}

/**
 * Trigger all registered context brokers when an intent is updated
 * @deprecated
 */
export async function triggerBrokersOnIntentUpdated(intentId: string, previousStatus?: string): Promise<void> {
  logger.info(`🎯 Triggering ${CONTEXT_BROKERS.length} context brokers for updated intent: ${intentId}`);

  const brokerPromises = CONTEXT_BROKERS.map(async (broker) => {
    try {
      logger.info(`🔄 Starting broker: ${broker.agentId} for updated intent: ${intentId}`);
      await broker.onIntentUpdated(intentId, previousStatus);
      logger.info(`✅ Broker ${broker.agentId} completed for updated intent: ${intentId}`);
    } catch (error) {
      logger.error(`❌ Broker ${broker.agentId} failed for updated intent ${intentId}:`, { error });
    }
  });

  await Promise.allSettled(brokerPromises);
  logger.info(`🏁 All brokers finished processing updated intent: ${intentId}`);
}

/**
 * Trigger all registered context brokers when an intent is archived
 * @deprecated
 */
export async function triggerBrokersOnIntentArchived(intentId: string): Promise<void> {
  logger.info(`🎯 Triggering ${CONTEXT_BROKERS.length} context brokers for archived intent: ${intentId}`);

  const brokerPromises = CONTEXT_BROKERS.map(async (broker) => {
    try {
      logger.info(`📦 Starting broker: ${broker.agentId} for archived intent: ${intentId}`);
      await broker.onIntentArchived(intentId);
      logger.info(`✅ Broker ${broker.agentId} completed for archived intent: ${intentId}`);
    } catch (error) {
      logger.error(`❌ Broker ${broker.agentId} failed for archived intent ${intentId}:`, { error });
    }
  });

  await Promise.allSettled(brokerPromises);
  logger.info(`🏁 All brokers finished processing archived intent: ${intentId}`);
}

/**
 * Register a new context broker
 * @deprecated
 */
export async function registerContextBroker(broker: ContextBroker): Promise<void> {
  // Ensure agent exists in database
  const existingAgent = await db.select()
    .from(agents)
    .where(eq(agents.id, broker.agentId))
    .limit(1);

  if (existingAgent.length === 0) {
    throw new Error(`Agent ${broker.agentId} not found in database`);
  }

  CONTEXT_BROKERS.push(broker);
  logger.info(`📝 Registered new context broker: ${broker.agentId}`);
}

/**
 * Get list of registered context brokers
 * @deprecated
 */
export function getRegisteredBrokers(): string[] {
  return CONTEXT_BROKERS.map(broker => broker.agentId);
}

/**
 * Get broker count for monitoring/debugging
 * @deprecated
 */
export function getBrokerCount(): number {
  return CONTEXT_BROKERS.length;
} 