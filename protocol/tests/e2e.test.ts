import { config } from 'dotenv';
import { resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

// Load environment variables
config({ path: resolve(__dirname, '../.env.development') });

// Enable email testing mode
process.env.ENABLE_EMAIL_TESTING = 'true';
process.env.TESTING_EMAIL_ADDRESS = 'test@example.com'; // Mock address

async function runTest() {
    console.log('🚀 Starting Email E2E Test...\n');

    // Dynamic imports
    const { default: db, closeDb } = await import('../src/lib/drizzle/drizzle');
    const { users, intents, intentStakes, agents } = await import('../src/lib/schema');
    const { analyzeContent } = await import('../src/agents/core/intent_inferrer');
    const { evaluateIntentPairMutuality } = await import('../src/agents/context_brokers/semantic_relevancy');
    const { sendConnectionRequestNotification } = await import('../src/lib/notification-service');

    try {
        // 1. Create Mock Users
        console.log('--- 1. Creating Mock Users ---');
        const aliceId = uuidv4();
        const bobId = uuidv4();

        await db.insert(users).values([
            {
                id: aliceId,
                email: `alice_${aliceId}@example.com`,
                name: 'Alice Test',
                privyId: `privy:${aliceId}`,
                intro: 'I am a software engineer looking for a co-founder.',
            },
            {
                id: bobId,
                email: `bob_${bobId}@example.com`,
                name: 'Bob Test',
                privyId: `privy:${bobId}`,
                intro: 'I am a product manager looking for a technical co-founder.',
            }
        ]);
        console.log('✅ Created Alice and Bob');

        // 2. Generate Intents
        console.log('\n--- 2. Generating Intents ---');
        const aliceBio = "I am building a decentralized social graph and need a co-founder.";
        const bobBio = "I want to join a startup building decentralized social protocols.";

        const aliceAnalysis = await analyzeContent(aliceBio, 1, "Extract professional interests.");
        const bobAnalysis = await analyzeContent(bobBio, 1, "Extract professional interests.");

        if (!aliceAnalysis.success || !bobAnalysis.success) {
            throw new Error('Failed to analyze content');
        }

        if (!aliceAnalysis.intents.length || !bobAnalysis.intents.length) {
            throw new Error('No intents generated from content analysis');
        }

        const aliceIntentPayload = aliceAnalysis.intents[0].payload;
        const bobIntentPayload = bobAnalysis.intents[0].payload;

        const [aliceIntent] = await db.insert(intents).values({
            userId: aliceId,
            payload: aliceIntentPayload,
            isIncognito: false
        }).returning();

        const [bobIntent] = await db.insert(intents).values({
            userId: bobId,
            payload: bobIntentPayload,
            isIncognito: false
        }).returning();

        console.log(`✅ Created intents:\nAlice: ${aliceIntentPayload}\nBob: ${bobIntentPayload}`);

        // 3. Create Stake (Match)
        console.log('\n--- 3. Creating Stake ---');

        // Mock intent objects for evaluation
        const intent1Obj = { ...aliceIntent, createdAt: aliceIntent.createdAt.toISOString() };
        const intent2Obj = { ...bobIntent, createdAt: bobIntent.createdAt.toISOString() };

        const evaluation = await evaluateIntentPairMutuality(intent1Obj, intent2Obj);

        if (!evaluation || !evaluation.isMutual) {
            console.warn('⚠️ No mutual match found automatically. Forcing stake for test.');
        }

        // Get an agent ID (assuming one exists, or create a dummy one)
        let agent = await db.select().from(agents).limit(1);
        let agentId;
        if (agent.length === 0) {
            const [newAgent] = await db.insert(agents).values({
                name: 'Test Agent',
                description: 'Test Agent',
                avatar: 'test'
            }).returning();
            agentId = newAgent.id;
        } else {
            agentId = agent[0].id;
        }

        await db.insert(intentStakes).values({
            intents: [aliceIntent.id, bobIntent.id],
            stake: BigInt(90),
            reasoning: evaluation?.reasoning || "Forced match for testing",
            agentId: agentId
        });
        console.log('✅ Created stake between Alice and Bob');

        // 4. Send Email
        console.log('\n--- 4. Sending Connection Request Email ---');
        await sendConnectionRequestNotification(aliceId, bobId);
        console.log('✅ Email sending triggered');

        // 5. Verify Log
        console.log('\n--- 5. Verifying Log ---');
        const { readFile } = await import('fs/promises');
        const { resolve } = await import('path');
        const debugPath = resolve(process.cwd(), 'email-debug.md');

        try {
            const debugContent = await readFile(debugPath, 'utf-8');
            if (debugContent.includes('Subject:') && debugContent.includes('Alice Test')) {
                console.log('✅ Email successfully logged in email-debug.md');
            } else {
                console.error('❌ Email not found in log or content mismatch');
            }
        } catch (err) {
            console.error('❌ Failed to read email-debug.md', err);
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await closeDb();
    }
}

runTest();
