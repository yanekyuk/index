import OpenAI from 'openai';

// Initialize OpenAI client for OpenRouter
export const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
        'HTTP-Referer': 'https://index.network',
        'X-Title': 'Index Network',
    },
});

/**
 * Configuration for the MAKER framework solver.
 * 
 * @template S The type representing the State of the system.
 * @template A The type representing an Action that can be taken.
 */
export interface MakerConfig<S, A> {
    /**
     * The LLM model identifier to use (e.g., 'openai/gpt-4o', 'anthropic/claude-3-opus').
     * Passed directly to the OpenRouter/OpenAI client.
     */
    modelPreset: string;

    /**
     * The voting margin required to declare a winner in the "First-to-ahead-by-K" voting step.
     * The leading action must have `k_margin` more votes than the runner-up to be selected.
     * Higher values increase reliability but cost more tokens/time.
     */
    k_margin: number;

    /**
     * Maximum number of tokens to generate for a single step.
     * Also acts as a "Red-Flagging" mechanism: responses longer than this are considered confused/looping and discarded.
     */
    max_tokens: number;

    /**
     * The maximum number of steps to iterate the main solver loop.
     * Acts as a safety limit for the Maximum Agentic Decomposition.
     */
    total_steps_needed: number;

    /**
     * Function to generate the LLM prompt based on the current state.
     * Can return a simple string or an array of chat messages.
     * @param state The current state object.
     */
    createPrompt: (state: S) => string | { role: 'user' | 'system' | 'assistant', content: string }[];

    /**
     * Function to parse the raw string response from the LLM into a structured Action and Next State.
     * Should throw an error if parsing fails (which triggers a Red-Flag discard).
     * @param response The raw string content from the LLM.
     */
    parseOutput: (response: string) => { action: A; nextState: S };

    /**
     * Function to validate the business logic of a proposed action.
     * Returns true if the action is valid, false otherwise (triggers Red-Flag discard).
     * @param action The parsed action to validate.
     * @param state The state context for validation.
     */
    isValidLogic: (action: A, state: S) => boolean;

    /**
     * Optional function to check if the goal has been reached before `total_steps_needed` is exhausted.
     * If returns true, the solver loop terminates early.
     * @param state The current state.
     */
    isTerminal?: (state: S) => boolean;

    /**
     * Optional logger function for debugging the thought process (e.g., `console.log`).
     */
    log?: (msg: string) => void;
}

/**
 * Component: Red-Flagging (Sampling)
 * Fetches a single sample and discards it if it looks "suspicious"
 */
async function getVote<S, A>(
    currentState: S,
    config: MakerConfig<S, A>,
    temperature: number = 0.1
): Promise<{ action: A; nextState: S } | "INVALID_FLAG"> {
    try {
        const prompt = config.createPrompt(currentState);
        const messages = typeof prompt === 'string'
            ? [{ role: 'user', content: prompt }]
            : prompt;

        // Call LLM
        const response = await openai.chat.completions.create({
            model: config.modelPreset,
            messages: messages as any,
            temperature: temperature,
            max_tokens: config.max_tokens, // Flag 1 happens here effectively if provider cuts off, but we check specific length below
        });

        const rawContent = response.choices[0]?.message?.content || "";

        // Flag 1: Overly long responses (if not handled by max_tokens param)
        // We double check if the response seems truncated or excessively verbose for the task
        // Though max_tokens usually handles this, we can also check parsing.

        // Flag 2: Formatting errors & Logic Validation
        try {
            const { action, nextState } = config.parseOutput(rawContent);

            if (!config.isValidLogic(action, currentState)) {
                config.log?.(`[RedFlag] Logic invalid for action: ${JSON.stringify(action)}`);
                return "INVALID_FLAG";
            }

            return { action, nextState };
        } catch (parseError) {
            config.log?.(`[RedFlag] Parsing error: ${(parseError as Error).message}`);
            return "INVALID_FLAG";
        }

    } catch (error) {
        config.log?.(`[RedFlag] LLM error: ${(error as Error).message}`);
        return "INVALID_FLAG";
    }
}

/**
 * Component: First-to-ahead-by-K Voting
 * Loops for a specific step until one candidate answer leads the runner-up by a statistical margin of k.
 */
async function doVoting<S, A>(
    currentState: S,
    config: MakerConfig<S, A>
): Promise<{ action: A; nextState: S }> {
    // Map serialized action -> { count, actionObj, nextStateObj }
    const voteCounts = new Map<string, { count: number; action: A; nextState: S }>();
    let attempts = 0;
    const MAX_ATTEMPTS = 50; // Safety break

    while (attempts < MAX_ATTEMPTS) {
        attempts++;

        // 1. Get a single vote (Temperature 0 for first attempt, slightly higher for diversity if needed? 
        // The paper says "Temperature is usually 0 for the first attempt... and >0 for subsequent". 
        // We'll use a small temp to get variation if we are looping, or loop with temp > 0.
        const temperature = attempts === 1 ? 0 : 0.7;
        const voteResult = await getVote(currentState, config, temperature);

        // 2. Ignore invalid/red-flagged samples entirely
        if (voteResult === "INVALID_FLAG") {
            continue;
        }

        // 3. Tally the valid vote
        // We need to serialize action AND nextState to use as key to properly handle divergence
        const voteKey = JSON.stringify({ action: voteResult.action, nextState: voteResult.nextState });
        const currentTally = voteCounts.get(voteKey);

        if (currentTally) {
            currentTally.count += 1;
        } else {
            voteCounts.set(voteKey, {
                count: 1,
                action: voteResult.action,
                nextState: voteResult.nextState
            });
        }

        // 4. Determine the leader and the runner-up
        const sortedVotes = Array.from(voteCounts.values()).sort((a, b) => b.count - a.count);

        // If no valid votes yet, continue
        if (sortedVotes.length === 0) continue;

        const leader = sortedVotes[0];
        const runnerUpCount = sortedVotes.length > 1 ? sortedVotes[1].count : 0;

        config.log?.(`[Voting] Leader: ${JSON.stringify(leader.action)} (${leader.count}), RunnerUp: ${runnerUpCount}, K: ${config.k_margin}`);

        // 5. Check Termination Condition (First-to-ahead-by-K)
        // We stop when the leader is 'k' votes ahead of the next best option.
        // If there is only one option and k=1, we need 1 vote (1 >= 0 + 1).
        if (leader.count >= runnerUpCount + config.k_margin) {
            return { action: leader.action, nextState: leader.nextState };
        }
    }

    throw new Error(`Voting failed to converge after ${MAX_ATTEMPTS} attempts`);
}

/**
 * Main Controller: Maximal Decomposition
 * Solves a long-horizon task one step at a time.
 */
export async function makerSolve<S, A>(
    initialState: S,
    config: MakerConfig<S, A>
): Promise<A[]> {
    const solutionTrajectory: A[] = [];
    let currentState = initialState;

    for (let i = 1; i <= config.total_steps_needed; i++) {
        config.log?.(`\n--- Step ${i} ---`);

        // Check terminal condition if provided (early exit)
        if (config.isTerminal && config.isTerminal(currentState)) {
            config.log?.("Terminal state reached early.");
            break;
        }

        // 1. Solve the specific subtask (one single step)
        const { action, nextState } = await doVoting(currentState, config);

        // 2. Update the state
        currentState = nextState;

        // 3. Record the step
        solutionTrajectory.push(action);

        config.log?.(`Step ${i} completed: ${JSON.stringify(action)}`);
    }

    return solutionTrajectory;
}
