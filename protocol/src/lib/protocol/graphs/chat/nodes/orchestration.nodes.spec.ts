import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  createCheckPrerequisitesNode,
  createLoadContextNode,
  createRouterNode,
  createOrchestratorNode,
} from './orchestration.nodes';
import type { ChatGraphCompositeDatabase } from '../../../interfaces/database.interface';
import type { RouterAgent } from '../../../agents/chat/router/chat.router';
import { log } from '../../../../log';

const logger = log.graph.from("orchestration.nodes.spec.ts");

describe('Orchestration Nodes', () => {
  let mockDatabase: Partial<ChatGraphCompositeDatabase>;
  let mockRouterAgent: Partial<RouterAgent>;

  beforeEach(() => {
    mockDatabase = {
      getProfile: mock(() => Promise.resolve({
        identity: { name: 'Test User', bio: 'Test bio', location: 'Test' },
        attributes: { skills: ['TypeScript'], interests: ['AI'] }
      } as any)),
      getActiveIntents: mock(() => Promise.resolve([
        { id: '1', payload: 'Test intent', summary: 'Test', createdAt: new Date() }
      ] as any)),
    };

    mockRouterAgent = {
      invoke: mock(() => Promise.resolve({
        target: 'respond' as const,
        confidence: 0.9,
        reasoning: 'Test routing',
        extractedContext: null,
        operationType: null
      })),
    };
  });

  describe('createCheckPrerequisitesNode', () => {
    it('should check profile and intent completeness', async () => {
      const node = createCheckPrerequisitesNode(
        mockDatabase as ChatGraphCompositeDatabase,
        logger
      );

      const result = await node({
        userId: 'user-1',
        messages: [],
      } as any);

      expect(result.hasCompleteProfile).toBe(true);
      expect(result.hasActiveIntents).toBe(true);
      expect(result.prerequisitesChecked).toBe(true);
      expect(mockDatabase.getProfile).toHaveBeenCalledWith('user-1');
      expect(mockDatabase.getActiveIntents).toHaveBeenCalledWith('user-1');
    });

    it('should handle errors gracefully', async () => {
      mockDatabase.getProfile = mock(() => Promise.reject(new Error('DB error')));
      
      const node = createCheckPrerequisitesNode(
        mockDatabase as ChatGraphCompositeDatabase,
        logger
      );

      const result = await node({
        userId: 'user-1',
        messages: [],
      } as any);

      expect(result.hasCompleteProfile).toBe(false);
      expect(result.hasActiveIntents).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('createLoadContextNode', () => {
    it('should load profile and format intents', async () => {
      const node = createLoadContextNode(
        mockDatabase as ChatGraphCompositeDatabase,
        logger
      );

      const result = await node({
        userId: 'user-1',
        messages: [],
      } as any);

      expect(result.userProfile).toBeDefined();
      expect(result.activeIntents).toContain('Test intent');
      expect(mockDatabase.getProfile).toHaveBeenCalled();
      expect(mockDatabase.getActiveIntents).toHaveBeenCalled();
    });
  });

  describe('createRouterNode', () => {
    it('should invoke router agent and return decision', async () => {
      const node = createRouterNode(
        mockRouterAgent as RouterAgent,
        logger
      );

      const result = await node({
        userId: 'user-1',
        messages: [{ content: 'Hello', _getType: () => 'human' } as any],
        userProfile: {
          identity: { name: 'Test', bio: '', location: '' },
          attributes: { skills: [], interests: [] }
        } as any,
      } as any);

      expect(result.routingDecision).toBeDefined();
      expect(result.routingDecision?.target).toBe('respond');
      expect(mockRouterAgent.invoke).toHaveBeenCalled();
    });

    it('should handle routing errors with fallback', async () => {
      mockRouterAgent.invoke = mock(() => Promise.reject(new Error('Routing error')));
      
      const node = createRouterNode(
        mockRouterAgent as RouterAgent,
        logger
      );

      const result = await node({
        userId: 'user-1',
        messages: [{ content: 'Hello', _getType: () => 'human' } as any],
      } as any);

      expect(result.routingDecision?.target).toBe('respond');
      expect(result.error).toBeDefined();
    });
  });

  describe('createOrchestratorNode', () => {
    it('should detect when no more operations are needed', async () => {
      const node = createOrchestratorNode(logger);

      const result = await node({
        userId: 'user-1',
        messages: [{ content: 'Hello', _getType: () => 'human' } as any],
        completedOperations: [],
      } as any);

      expect(result.needsMoreOperations).toBe(false);
    });

    it('should chain scrape to profile_write when conditions met', async () => {
      const node = createOrchestratorNode(logger);

      const result = await node({
        userId: 'user-1',
        messages: [{ content: 'Update my profile from this link', _getType: () => 'human' } as any],
        completedOperations: ['scrape_web'],
        subgraphResults: {
          scrape: {
            url: 'https://example.com',
            content: 'Scraped content',
            contentLength: 100
          }
        },
      } as any);

      expect(result.needsMoreOperations).toBe(true);
      expect(result.routingDecision?.target).toBe('profile_write');
    });
  });
});
