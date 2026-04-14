import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, it, expect, beforeEach } from 'bun:test';
import type { TelegramPrefs } from '../../schemas/database.schema';

// ── Fakes ────────────────────────────────────────────────────────────────────

interface SentMessage { chatId: string; text: string; keyboard?: unknown }

function makeDeps(overrides: Partial<ReturnType<typeof defaultDeps>> = {}) {
  return { ...defaultDeps(), ...overrides };
}

function defaultDeps() {
  const sessions = new Map<string, { id: string; userId: string }>();
  const messages: Array<{ sessionId: string; role: string; content: string }> = [];
  const sent: SentMessage[] = [];
  const telegramPrefs = new Map<string, TelegramPrefs>();
  const chatIdIndex = new Map<string, { userId: string; sessionId?: string }>();

  return {
    sent,
    messages,
    sessions,
    telegramPrefs,
    chatIdIndex,
    getTelegramPrefs: async (userId: string) => telegramPrefs.get(userId) ?? null,
    updateTelegramPrefs: async (userId: string, prefs: TelegramPrefs) => { telegramPrefs.set(userId, prefs); },
    findByTelegramChatId: async (chatId: string) => chatIdIndex.get(chatId) ?? null,
    createChatSession: async (data: { id: string; userId: string; title?: string }) => { sessions.set(data.id, data); },
    createChatMessage: async (data: { id: string; sessionId: string; role: string; content: string }) => { messages.push(data); },
    processMessage: async (_userId: string, _text: string) => ({ responseText: 'Hello from Index!' }),
    sendTelegramMessage: async (chatId: string, text: string, keyboard?: unknown) => { sent.push({ chatId, text, keyboard }); },
    seedTelegramUser: (userId: string, prefs: TelegramPrefs) => {
      telegramPrefs.set(userId, prefs);
      chatIdIndex.set(prefs.chatId, { userId, sessionId: prefs.sessionId });
    },
  };
}

// ── Tests: handleOutbound ────────────────────────────────────────────────────

describe('handleOutbound', () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => { deps = makeDeps(); });

  it('sends the message and writes it to the existing session', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-1',
      sessionId: 'session-1',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true, negotiationTurn: false },
    };
    deps.seedTelegramUser('user-1', prefs);

    const { handleOutbound } = await import('../telegram.gateway');
    await handleOutbound({ userId: 'user-1', message: 'You have a new match!' }, deps);

    expect(deps.sent).toHaveLength(1);
    expect(deps.sent[0]).toMatchObject({ chatId: 'chat-1', text: 'You have a new match!' });
    expect(deps.messages).toHaveLength(1);
    expect(deps.messages[0]).toMatchObject({ sessionId: 'session-1', role: 'assistant', content: 'You have a new match!' });
  });

  it('creates a session lazily when sessionId is missing', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-2',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true, negotiationTurn: false },
    };
    deps.seedTelegramUser('user-2', prefs);

    const { handleOutbound } = await import('../telegram.gateway');
    await handleOutbound({ userId: 'user-2', message: 'Hello!' }, deps);

    expect(deps.sessions.size).toBe(1);
    const [session] = [...deps.sessions.values()];
    expect(session.userId).toBe('user-2');
    expect(deps.messages[0].sessionId).toBe(session.id);
    // prefs updated with new sessionId
    expect(deps.telegramPrefs.get('user-2')?.sessionId).toBe(session.id);
  });

  it('logs and returns silently when user has no Telegram connection', async () => {
    const { handleOutbound } = await import('../telegram.gateway');
    await handleOutbound({ userId: 'ghost-user', message: 'test' }, deps);
    expect(deps.sent).toHaveLength(0);
  });

  it('passes inline buttons to sendTelegramMessage', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-3',
      sessionId: 'session-3',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true, negotiationTurn: false },
    };
    deps.seedTelegramUser('user-3', prefs);

    const { handleOutbound } = await import('../telegram.gateway');
    await handleOutbound(
      { userId: 'user-3', message: 'New match!', inlineButtons: [{ text: 'View', url: 'https://index.network/o/1' }] },
      deps,
    );

    expect(deps.sent[0].keyboard).toEqual([[{ text: 'View', url: 'https://index.network/o/1' }]]);
  });
});
