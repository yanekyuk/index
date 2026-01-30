import { config } from "dotenv";
config({ path: '.env.development', override: true });

import { describe, expect, it } from "bun:test";
import { ResponseGeneratorAgent } from './chat.generator';
import type { RouterOutput } from '../router/chat.router';
import type { SubgraphResults } from './chat.generator';

describe('ResponseGeneratorAgent - Hallucination Prevention', () => {
  const responseGenerator = new ResponseGeneratorAgent();

  it('should show validation warning when no actions taken with respond target', () => {
    const routingDecision: RouterOutput = {
      target: 'respond',
      operationType: null,
      confidence: 0.9,
      reasoning: 'General conversation',
      extractedContext: null
    };
    
    const subgraphResults: SubgraphResults = {};
    
    const formattedResults = responseGenerator.formatSubgraphResults(subgraphResults);
    
    expect(formattedResults.includes('WARNING') || formattedResults.includes('No subgraph results available')).toBe(true);
  });

  it('should show warning when intent_write target has empty actions', () => {
    const routingDecision: RouterOutput = {
      target: 'intent_write',
      operationType: 'update',
      confidence: 0.85,
      reasoning: 'Update intent detected',
      extractedContext: null
    };
    
    const subgraphResults: SubgraphResults = {
      intent: {
        mode: 'write',
        actions: [],  // Empty actions array
        inferredIntents: ['Create a text-based RPG game']
      }
    };
    
    const formattedResults = responseGenerator.formatSubgraphResults(subgraphResults);
    
    expect(formattedResults.includes('WARNING')).toBe(true);
    expect(formattedResults.includes('No actual database operations')).toBe(true);
  });

  it('should show UPDATE action correctly without false warnings', () => {
    const routingDecision: RouterOutput = {
      target: 'intent_write',
      operationType: 'update',
      confidence: 0.95,
      reasoning: 'Update intent detected',
      extractedContext: null
    };
    
    const subgraphResults: SubgraphResults = {
      intent: {
        mode: 'write',
        actions: [{
          type: 'update',
          id: 'intent-123',
          payload: 'Create a text-based RPG game with LLM-enhanced narration',
          score: 0.9,
          reasoning: 'Updated based on user request',
          intentMode: 'ATTRIBUTIVE'
        }],
        inferredIntents: ['Create a text-based RPG game with LLM-enhanced narration']
      }
    };
    
    const formattedResults = responseGenerator.formatSubgraphResults(subgraphResults);
    
    expect(formattedResults.includes('UPDATE')).toBe(true);
    expect(formattedResults.includes('intent-123')).toBe(true);
    expect(formattedResults.includes('VALIDATION WARNING')).toBe(false);
  });

  it('should display query mode correctly without warnings', () => {
    const routingDecision: RouterOutput = {
      target: 'intent_query',
      operationType: 'read',
      confidence: 0.95,
      reasoning: 'User asking about intents',
      extractedContext: null
    };
    
    const subgraphResults: SubgraphResults = {
      intent: {
        mode: 'query',
        intents: [
          {
            id: 'intent-1',
            description: 'Learn Rust programming',
            summary: 'Focus on systems programming',
            createdAt: new Date('2026-01-15')
          },
          {
            id: 'intent-2',
            description: 'Build a CLI tool',
            createdAt: new Date('2026-01-20')
          }
        ],
        count: 2
      }
    };
    
    const formattedResults = responseGenerator.formatSubgraphResults(subgraphResults);
    
    expect(formattedResults.includes('Learn Rust programming')).toBe(true);
    expect(formattedResults.includes('Build a CLI tool')).toBe(true);
    expect(formattedResults.includes('VALIDATION WARNING')).toBe(false);
  });

  it('should show CREATE action correctly', () => {
    const routingDecision: RouterOutput = {
      target: 'intent_write',
      operationType: 'create',
      confidence: 0.92,
      reasoning: 'New intent creation detected',
      extractedContext: null
    };
    
    const subgraphResults: SubgraphResults = {
      intent: {
        mode: 'write',
        actions: [{
          type: 'create',
          payload: 'Learn functional programming with Haskell',
          score: 0.85,
          reasoning: 'New learning goal',
          intentMode: 'ATTRIBUTIVE',
          referentialAnchor: null,
          semanticEntropy: 0.2
        }],
        inferredIntents: ['Learn functional programming with Haskell']
      }
    };
    
    const formattedResults = responseGenerator.formatSubgraphResults(subgraphResults);
    
    expect(formattedResults.includes('CREATE')).toBe(true);
    expect(formattedResults.includes('functional programming')).toBe(true);
    expect(formattedResults.includes('VALIDATION WARNING')).toBe(false);
  });
});
