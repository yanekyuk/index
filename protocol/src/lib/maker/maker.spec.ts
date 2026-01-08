import { makerSolve, MakerConfig } from './maker';
// @ts-ignore
import { describe, it, expect, jest, beforeEach, mock, hoisted } from 'bun:test';

// Use jest.hoisted to ensure these are initialized before mock.module
const { mockCreateFn } = hoisted(() => {
  return { mockCreateFn: jest.fn() };
});

mock.module('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreateFn
      }
    };
  }

  return {
    default: MockOpenAI,
    OpenAI: MockOpenAI
  };
});

// We can now use mockCreateFn in our tests
const mockCreate = mockCreateFn;

type State = { count: number };
type Action = { type: 'INCREMENT'; value: number };

describe('MAKER Framework', () => {
  const config: MakerConfig<State, Action> = {
    modelPreset: 'test-model',
    k_margin: 1,
    max_tokens: 100,
    total_steps_needed: 3,

    createPrompt: (state) => `Count is ${state.count}`,

    parseOutput: (response) => {
      try {
        return JSON.parse(response);
      } catch {
        throw new Error("Parse error");
      }
    },

    isValidLogic: (action, state) => action.value === 1,

    log: jest.fn() // Silence logs
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Red-Flagging', () => {
    it('should discard responses that fail parsing', async () => {
      // Mock invalid JSON response then valid response
      mockCreate
        .mockResolvedValueOnce({
          choices: [{ message: { content: "Invalid JSON" } }]
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify({ action: { type: 'INCREMENT', value: 1 }, nextState: { count: 1 } }) } }]
        });

      await makerSolve({ count: 0 }, { ...config, total_steps_needed: 1 });

      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('should discard responses that fail logic validation', async () => {
      mockCreate
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify({ action: { type: 'INCREMENT', value: 2 }, nextState: { count: 2 } }) } }] // Invalid value 2
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify({ action: { type: 'INCREMENT', value: 1 }, nextState: { count: 1 } }) } }] // Valid
        });

      await makerSolve({ count: 0 }, { ...config, total_steps_needed: 1 });
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('Voting (First-to-ahead-by-K)', () => {
    it('should terminate voting when margin is reached', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ action: { type: 'INCREMENT', value: 1 }, nextState: { count: 1 } }) } }]
      });

      await makerSolve({ count: 0 }, { ...config, total_steps_needed: 1, k_margin: 1 });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should continue voting if margin not reached', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ action: { type: 'INCREMENT', value: 1 }, nextState: { count: 1 } }) } }]
      });

      await makerSolve({ count: 0 }, { ...config, total_steps_needed: 1, k_margin: 2 });
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('should handle contention correctly', async () => {
      config.k_margin = 2;

      const contentionConfig: MakerConfig<State, Action> = {
        ...config,
        isValidLogic: (a) => true,
        parseOutput: (res) => JSON.parse(res)
      };

      const respA = { choices: [{ message: { content: JSON.stringify({ action: { type: 'INCREMENT', value: 1 }, nextState: { count: 1 } }) } }] };
      const respB = { choices: [{ message: { content: JSON.stringify({ action: { type: 'INCREMENT', value: 100 }, nextState: { count: 100 } }) } }] };

      mockCreate
        .mockResolvedValueOnce(respA)
        .mockResolvedValueOnce(respB)
        .mockResolvedValueOnce(respA)
        .mockResolvedValueOnce(respA);

      const result = await makerSolve({ count: 0 }, { ...contentionConfig, total_steps_needed: 1, k_margin: 2 });

      expect(result[0].value).toBe(1);
      expect(mockCreate).toHaveBeenCalledTimes(4);
    });

    it('should treat same action with different states as different votes (divergence handling)', async () => {
      config.k_margin = 1;
      // We need 1 vote margin.
      // Vote 1: Action A, State X. Leader: {A,X}=1, Runner: 0. Margin 1. WINS immediately if we don't have divergence check or if valid.
      // Wait, if it wins immediately, we can't test divergence.
      // We need k_margin such that 1 vote isn't enough OR specific sequence.

      // Let's use k_margin=1.
      // Vote 1: {A, X}. Leader: {A,X}=1. RunnerUp: 0. 1 >= 1. Wins (in first iteration, sortedVotes length is 1).

      // To test divergence, we need to ensure that subsequent attributes don't get merged into the first one IF we were to run more.
      // Actually, deeper issue: If Action A / State X wins, it returns Action A / State X.
      // If standard code disregarded State, Action A / State X might win but internal state might be confused?
      // The criticism was: "ignores later differing nextState values".
      // Meaning: Vote 1: A -> X. Vote 2: A -> Y.
      // Old Logic: Key = "A". Count = 2. It thinks it has high confidence.
      // New Logic: Key1 = "A->X". Key2 = "A->Y". Count each = 1. No consensus.

      // So to test this: k_margin=2.
      // Call 1: A -> X
      // Call 2: A -> Y
      // Old Logic: Leader "A" has 2 votes. Runner 0. 2 >= 2. TERMINATES.
      // New Logic: Leader "A->X" has 1. Runner "A->Y" has 1. 1 < 1+2. CONTINUES.

      const respAX = { choices: [{ message: { content: JSON.stringify({ action: { type: 'INCREMENT', value: 1 }, nextState: { count: 10 } }) } }] };
      const respAY = { choices: [{ message: { content: JSON.stringify({ action: { type: 'INCREMENT', value: 1 }, nextState: { count: 99 } }) } }] }; // Different state
      const respAX_confirm = { choices: [{ message: { content: JSON.stringify({ action: { type: 'INCREMENT', value: 1 }, nextState: { count: 10 } }) } }] };

      mockCreate
        .mockResolvedValueOnce(respAX)
        .mockResolvedValueOnce(respAY) // Divergence!
        .mockResolvedValueOnce(respAX_confirm) // Confirm A->X
        .mockResolvedValueOnce(respAX_confirm); // Confirm A->X again (Total A->X: 3. A->Y: 1. Margin 2.)

      // We need A->X to reach 3 to beat A->Y (count 1) by 2?
      // 3 - 1 = 2. Yes.

      const result = await makerSolve({ count: 0 }, { ...config, total_steps_needed: 1, k_margin: 2 });

      expect(mockCreate).toHaveBeenCalledTimes(4);
      // If old logic was present, it would have returned after 2 calls (Count 2 vs 0).

      expect(result[0].value).toBe(1);
    });
  });

  describe('Maximal Decomposition (Controller)', () => {
    it('should execute for specified steps', async () => {
      mockCreate.mockImplementation(({ messages }: any) => {
        const content = messages[0].content;
        const countMatch = content.match(/Count is (\d+)/);
        const count = countMatch ? parseInt(countMatch[1]) : 0;
        return Promise.resolve({
          choices: [{
            message: {
              content: JSON.stringify({
                action: { type: 'INCREMENT', value: 1 },
                nextState: { count: count + 1 }
              })
            }
          }]
        });
      });

      const trajectory = await makerSolve({ count: 0 }, { ...config, total_steps_needed: 3, k_margin: 1 });

      expect(trajectory).toHaveLength(3);
      expect(trajectory[0].value).toBe(1);
      expect(trajectory[1].value).toBe(1);
      expect(trajectory[2].value).toBe(1);

      expect(mockCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({ messages: [{ role: 'user', content: 'Count is 0' }] }));
      expect(mockCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({ messages: [{ role: 'user', content: 'Count is 1' }] }));
      expect(mockCreate).toHaveBeenNthCalledWith(3, expect.objectContaining({ messages: [{ role: 'user', content: 'Count is 2' }] }));
    });

    it('should terminate early if isTerminal returns true', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ action: { type: 'INCREMENT', value: 1 }, nextState: { count: 10 } }) } }]
      });

      const terminalConfig = {
        ...config,
        isTerminal: (state: State) => state.count >= 10
      };

      const trajectory = await makerSolve({ count: 0 }, { ...terminalConfig, total_steps_needed: 5, k_margin: 1 });

      expect(trajectory).toHaveLength(1);
    });
  });
});
