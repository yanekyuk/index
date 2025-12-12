import { makerSolve, MakerConfig, openai } from './index';
// @ts-ignore
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure these are initialized before vi.mock
const { mockCreateFn } = vi.hoisted(() => {
    return { mockCreateFn: vi.fn() };
});

vi.mock('openai', () => {
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

        log: vi.fn() // Silence logs
    };

    beforeEach(() => {
        vi.clearAllMocks();
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
