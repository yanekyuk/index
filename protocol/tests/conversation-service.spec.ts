import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(import.meta.dir, '../.env.development') });

import { describe, it, expect, afterAll } from 'bun:test';
import { ConversationService } from '../src/services/conversation.service';
import { TaskService } from '../src/services/task.service';

const conversationService = new ConversationService();
const taskService = new TaskService();
const cleanupIds: string[] = [];

afterAll(async () => {
  for (const id of cleanupIds) {
    try {
      const { conversationDatabaseAdapter } = await import('../src/adapters/database.adapter');
      await conversationDatabaseAdapter.deleteConversation(id);
    } catch {}
  }
});

describe('ConversationService', () => {
  it('creates conversation and sends message', async () => {
    const conv = await conversationService.createConversation([
      { participantId: 'svc-user-1', participantType: 'user' as const },
      { participantId: 'system-agent', participantType: 'agent' as const },
    ]);
    expect(conv.id).toBeDefined();
    cleanupIds.push(conv.id);

    const msg = await conversationService.sendMessage(conv.id, 'svc-user-1', 'user', [{ text: 'test message' }]);
    expect(msg.id).toBeDefined();
    expect(msg.parts).toEqual([{ text: 'test message' }]);
  }, 15000);

  it('getOrCreateDM deduplicates', async () => {
    const a = 'svc-dm-a-' + Date.now();
    const b = 'svc-dm-b-' + Date.now();
    const dm1 = await conversationService.getOrCreateDM(a, b);
    cleanupIds.push(dm1.id);
    const dm2 = await conversationService.getOrCreateDM(a, b);
    expect(dm1.id).toBe(dm2.id);
  }, 15000);

  it('lists conversations for user', async () => {
    const convs = await conversationService.getConversations('svc-user-1');
    expect(Array.isArray(convs)).toBe(true);
  }, 15000);

  it('hides conversation', async () => {
    const conv = await conversationService.createConversation([
      { participantId: 'svc-hide-user', participantType: 'user' as const },
      { participantId: 'system-agent', participantType: 'agent' as const },
    ]);
    cleanupIds.push(conv.id);
    await conversationService.hideConversation('svc-hide-user', conv.id);
    // No error thrown = success
  }, 15000);
});

describe('TaskService', () => {
  it('creates task and transitions states', async () => {
    const conv = await conversationService.createConversation([
      { participantId: 'task-svc-user', participantType: 'user' as const },
      { participantId: 'system-agent', participantType: 'agent' as const },
    ]);
    cleanupIds.push(conv.id);

    const task = await taskService.createTask(conv.id);
    expect(task.state).toBe('submitted');

    const working = await taskService.updateState(task.id, 'working');
    expect(working.state).toBe('working');

    const completed = await taskService.updateState(task.id, 'completed');
    expect(completed.state).toBe('completed');
  }, 15000);

  it('creates and retrieves artifacts', async () => {
    const conv = await conversationService.createConversation([
      { participantId: 'art-svc-user', participantType: 'user' as const },
      { participantId: 'system-agent', participantType: 'agent' as const },
    ]);
    cleanupIds.push(conv.id);
    const task = await taskService.createTask(conv.id);

    const artifact = await taskService.createArtifact(task.id, {
      name: 'opportunity-card',
      parts: [{ data: { opportunityId: 'opp-1', score: 0.85 }, media_type: 'application/json' }],
    });
    expect(artifact.name).toBe('opportunity-card');

    const artifacts = await taskService.getArtifacts(task.id);
    expect(artifacts).toHaveLength(1);
  }, 15000);
});
