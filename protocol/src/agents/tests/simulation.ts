import { MOCK_USERS } from './fixtures';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from project root
const envPath = path.resolve(__dirname, '../../../.env.development');
dotenv.config({ path: envPath });

async function runSimulation() {
    // Dynamic imports to ensure env vars are loaded first
    const { analyzeContent } = await import('../core/intent_inferrer/index.js');
    const { introMaker } = await import('../external/intro_maker/index.js');
    const { evaluateIntentPairMutuality } = await import('../context_brokers/semantic_relevancy/index.js');

    console.log('🚀 Starting Agent Simulation...\n');

    const userIntents = new Map<string, string[]>();
    const userReasonings = new Map<string, string[]>();

    // Step 1: Inference
    console.log('--- STEP 1: INTENT INFERENCE ---\n');

    for (const user of MOCK_USERS) {
        console.log(`Analyzing ${user.name}...`);
        console.log(`Bio: "${user.bio}"`);

        try {
            // Analyze content to get intents
            const result = await analyzeContent(user.bio, 1, "Extract professional interests and needs.");

            if (result.success && result.intents.length > 0) {
                console.log(`✅ Extracted ${result.intents.length} intents:`);
                const intents = result.intents.map(i => i.payload);
                userIntents.set(user.id, intents);

                // For this simulation, we'll use the intents as "reasonings" for the intro maker
                // In the real app, reasonings come from the "stakes" (why they matched)
                userReasonings.set(user.id, intents);

                result.intents.forEach(intent => {
                    console.log(`   - [${intent.type}] ${intent.payload} (${intent.confidence})`);
                });
            } else {
                console.log('⚠️ No intents found.');
            }
        } catch (error) {
            console.error(`❌ Error analyzing user ${user.name}:`, error);
        }
        console.log('\n');
    }

    // Step 2: Matching (Semantic)
    console.log('--- STEP 2: MATCHING (SEMANTIC) ---\n');

    // We'll manually define a match we expect to happen based on the mock data
    // Alice (Rust) <-> Bob (Privacy + Rust)
    const match = {
        user1: MOCK_USERS[0], // Alice
        user2: MOCK_USERS[1]  // Bob
    };

    console.log(`Checking semantic match between ${match.user1.name} and ${match.user2.name}...`);

    const intents1 = userIntents.get(match.user1.id) || [];
    const intents2 = userIntents.get(match.user2.id) || [];

    let bestMatch: { score: number, reasoning: string, intent1: string, intent2: string } | null = null;

    // Compare all intent pairs
    for (const intent1Payload of intents1) {
        for (const intent2Payload of intents2) {
            // Mock intent objects for the evaluator
            const intent1Obj = {
                id: 'mock-id-1',
                payload: intent1Payload,
                createdAt: new Date().toISOString()
            };
            const intent2Obj = {
                id: 'mock-id-2',
                payload: intent2Payload,
                createdAt: new Date().toISOString()
            };

            console.log(`\nEvaluating pair:\n  A: "${intent1Payload}"\n  B: "${intent2Payload}"`);

            try {
                const evaluation = await evaluateIntentPairMutuality(intent1Obj, intent2Obj);

                if (evaluation) {
                    console.log(`  -> Mutual: ${evaluation.isMutual}, Score: ${evaluation.confidenceScore}`);
                    if (evaluation.isMutual) {
                        console.log(`  -> Reasoning: ${evaluation.reasoning}`);
                    }

                    if (evaluation.isMutual && evaluation.confidenceScore >= 70) {
                        // Keep track of the best match
                        if (!bestMatch || evaluation.confidenceScore > bestMatch.score) {
                            bestMatch = {
                                score: evaluation.confidenceScore,
                                reasoning: evaluation.reasoning,
                                intent1: intent1Payload,
                                intent2: intent2Payload
                            };
                        }
                    }
                }
            } catch (err) {
                console.error('  -> Error evaluating pair:', err);
            }
        }
    }

    if (bestMatch) {
        console.log(`\n✅ Best Match Found! Score: ${bestMatch.score}`);
        console.log(`Reasoning: ${bestMatch.reasoning}\n`);

        // Step 3: Action (Intro Maker)
        console.log('--- STEP 3: ACTION (INTRO MAKER) ---\n');

        try {
            const introResult = await introMaker({
                sender: {
                    id: match.user1.id,
                    userName: match.user1.name,
                    reasonings: [bestMatch.intent1] // Pass the specific matching intent
                },
                recipient: {
                    id: match.user2.id,
                    userName: match.user2.name,
                    reasonings: [bestMatch.intent2] // Pass the specific matching intent
                }
            });

            if (introResult.success) {
                console.log('💌 Generated Introduction Email Content:');
                console.log('---------------------------------------------------');
                console.log(introResult.synthesis);
                console.log('---------------------------------------------------');
            } else {
                console.error('❌ Failed to generate intro:', introResult.error);
            }
        } catch (error) {
            console.error('❌ Error running intro maker:', error);
        }

    } else {
        console.log('❌ No high-confidence mutual match found.');
    }

    console.log('\n🏁 Simulation Complete.');
}

// Run the simulation
runSimulation().catch(console.error);
