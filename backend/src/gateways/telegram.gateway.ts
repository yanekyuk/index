import { log } from '../lib/log';
import { onTelegramNotification, type TelegramNotificationPayload } from '../lib/notification-events';
import type { TelegramPrefs } from '../schemas/database.schema';

const logger = log.lib.from('telegram.gateway');

export const CONNECT_TOKEN_PREFIX = 'telegram:connect:';
export const CONNECT_TOKEN_TTL_SEC = 15 * 60;

// ── Dependency interface (injected in tests, resolved from singletons in prod) ─

export interface GatewayDeps {
  getTelegramPrefs(userId: string): Promise<TelegramPrefs | null>;
  updateTelegramPrefs(userId: string, prefs: TelegramPrefs): Promise<void>;
  findByTelegramChatId(chatId: string): Promise<{ userId: string; sessionId?: string } | null>;
  createChatSession(data: { id: string; userId: string; title?: string }): Promise<void>;
  createChatMessage(data: { id: string; sessionId: string; role: string; content: string }): Promise<void>;
  processMessage(userId: string, text: string): Promise<{ responseText: string; error?: string }>;
  sendTelegramMessage(chatId: string, text: string, keyboard?: Array<Array<{ text: string; url: string }>>): Promise<void>;
}

/**
 * Lazily resolved production deps — imports are deferred to avoid pulling
 * heavy transitive modules (e.g. @indexnetwork/protocol) during test discovery.
 */
function productionDeps(): GatewayDeps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { userDatabaseAdapter, conversationDatabaseAdapter } = require('../adapters/database.adapter') as typeof import('../adapters/database.adapter');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chatSessionService } = require('../services/chat.service') as typeof import('../services/chat.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sendMessage } = require('../lib/telegram/bot-api') as typeof import('../lib/telegram/bot-api');
  return {
    getTelegramPrefs: (userId) => userDatabaseAdapter.getTelegramPrefs(userId),
    updateTelegramPrefs: (userId, prefs) => userDatabaseAdapter.updateTelegramPrefs(userId, prefs),
    findByTelegramChatId: (chatId) => userDatabaseAdapter.findByTelegramChatId(chatId),
    createChatSession: (data) => conversationDatabaseAdapter.createChatSession(data),
    createChatMessage: (data) => conversationDatabaseAdapter.createChatMessage(data),
    processMessage: (userId, text) => chatSessionService.processMessage(userId, text),
    sendTelegramMessage: sendMessage,
  };
}

/**
 * Handle a notification event: deliver via Telegram and write to conversation.
 * @param payload - Notification payload from the NotificationQueue
 * @param deps - Injectable deps (defaults to production singletons)
 */
export async function handleOutbound(
  payload: TelegramNotificationPayload,
  deps: GatewayDeps = productionDeps(),
): Promise<void> {
  const currentPrefs = await deps.getTelegramPrefs(payload.userId);
  if (!currentPrefs) {
    logger.warn('Telegram outbound skipped: no connection', { userId: payload.userId });
    return;
  }

  const { chatId } = currentPrefs;
  let { sessionId } = currentPrefs;

  // Create chat session lazily on first notification
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    await deps.createChatSession({ id: sessionId, userId: payload.userId, title: 'Telegram' });
    await deps.updateTelegramPrefs(payload.userId, { ...currentPrefs, sessionId });
  }

  const keyboard = payload.inlineButtons
    ? [payload.inlineButtons.map((b) => ({ text: b.text, url: b.url }))]
    : undefined;

  await deps.sendTelegramMessage(chatId, payload.message, keyboard);

  await deps.createChatMessage({
    id: crypto.randomUUID(),
    sessionId,
    role: 'assistant',
    content: payload.message,
  });
}

/**
 * Subscribe the gateway to Telegram notification events.
 * Call once at startup (from main.ts).
 */
export function init(): void {
  onTelegramNotification((payload) => {
    handleOutbound(payload).catch((err) => {
      logger.error('Telegram outbound delivery failed', { userId: payload.userId, error: err });
    });
  });
}

// handleInbound added in Task 5
