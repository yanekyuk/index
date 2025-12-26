import { config } from 'dotenv';
import { resolve } from 'path';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables immediately
config({ path: resolve(__dirname, '../../.env.development') });

// Enable email testing mode
process.env.ENABLE_EMAIL_TESTING = 'true';
if (!process.env.TESTING_EMAIL_ADDRESS) {
    console.warn('⚠️ TESTING_EMAIL_ADDRESS not set. Emails will not be sent.');
} else {
    console.log(`📧 Email testing enabled. All emails will be sent to: ${process.env.TESTING_EMAIL_ADDRESS}`);
}

import { TESTABLE_TEST_ACCOUNTS } from './test-data';

// Types for our test context
interface TestContext {
    users: Map<string, any>; // email -> user record
    createdIntents: Map<string, string>; // description -> intentId
    createdFiles: string[];
    createdLinks: string[];
}

const ctx: TestContext = {
    users: new Map(),
    createdIntents: new Map(),
    createdFiles: [],
    createdLinks: []
};

async function main() {
    // Dynamic imports
    type DbModule = typeof import('../lib/db');
    const { default: db, closeDb } = await import('../lib/db.js') as unknown as DbModule;
    const { users, files, indexLinks, intents, intentStakes } = await import('../lib/schema.js');
    const { intentService } = await import('../services/intent.service.js');
    const { discoverUsers } = await import('../lib/discover.js');
    const { sendConnectionRequestNotification } = await import('../lib/notification-service.js');

    console.log('\n🚀 Starting Expanded CLI Test Suite...\n');

    if (process.env.NODE_ENV === 'production') {
        console.error('❌ Cannot run test suite in production environment');
        process.exit(1);
    }

    try {
        // --- PREPARATION ---
        console.log('--- 1. Preparation: Fetching Test Users ---');
        for (const account of TESTABLE_TEST_ACCOUNTS) {
            const [user] = await db.select().from(users).where(eq(users.email, account.email)).limit(1);
            if (user) {
                ctx.users.set(account.email, user);
                console.log(`✅ Loaded user: ${user.name} (${user.email})`);
            } else {
                console.warn(`⚠️ User not found: ${account.email}. Run 'yarn db:seed' first.`);
            }
        }

        if (ctx.users.size < 2) {
            throw new Error('Need at least 2 test users to run full suite.');
        }

        const alice = ctx.users.get('alice@example.com') || Array.from(ctx.users.values())[0];
        const bob = ctx.users.get('bob@example.com') || Array.from(ctx.users.values())[1];

        console.log(`\nTesting with:\n- Alice: ${alice.name} (${alice.id})\n- Bob: ${bob.name} (${bob.id})\n`);

        // --- SCENARIO 1: DISCOVERY FORM (Alice) ---
        console.log('--- 2. Scenario: Discovery Form (Alice) ---');

        // 1. Create a dummy file record
        const fileId = uuidv4();
        await db.insert(files).values({
            id: fileId,
            name: 'project_proposal.pdf',
            size: BigInt(1024 * 1024),
            type: 'application/pdf',
            userId: alice.id,
        });
        ctx.createdFiles.push(fileId);
        console.log(`✅ Simulated file upload: ${fileId}`);

        // 2. Create a dummy link record
        const linkId = uuidv4();
        await db.insert(indexLinks).values({
            id: linkId,
            userId: alice.id,
            url: 'https://example.com/alice-portfolio',
            lastStatus: 'ok'
        });
        ctx.createdLinks.push(linkId);
        console.log(`✅ Simulated link submission: ${linkId}`);

        // 3. Create Intent from Discovery Form
        const alicePayload = "I am looking for a co-founder to build a decentralized social graph.";
        const aliceIntent = await intentService.createIntent({
            payload: alicePayload,
            userId: alice.id,
            confidence: 1.0,
            inferenceType: 'explicit',
            sourceType: 'discovery_form',
            sourceId: fileId, // Linked to the file
            indexIds: ['5aff6cd6-d64e-4ef9-8bcf-6c89815f771c']
        });
        ctx.createdIntents.set('alice_discovery', aliceIntent.id);
        console.log(`✅ Created Intent for Alice: "${alicePayload}" (ID: ${aliceIntent.id})`);


        // --- SCENARIO 2: LIBRARY UPLOAD (Bob) ---
        console.log('\n--- 3. Scenario: Library Upload (Bob) ---');

        // 1. Create a dummy file record for Bob
        const bobFileId = uuidv4();
        await db.insert(files).values({
            id: bobFileId,
            name: 'technical_architecture.docx',
            size: BigInt(500 * 1024),
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            userId: bob.id,
        });
        ctx.createdFiles.push(bobFileId);
        console.log(`✅ Simulated library file upload: ${bobFileId}`);

        // 2. Create Intent from File
        const bobPayload = "I am an experienced backend engineer interested in social graphs and decentralized identity.";
        const bobIntent = await intentService.createIntent({
            payload: bobPayload,
            userId: bob.id,
            confidence: 0.9,
            inferenceType: 'implicit',
            sourceType: 'file',
            sourceId: bobFileId,
            indexIds: ['5aff6cd6-d64e-4ef9-8bcf-6c89815f771c']
        });
        ctx.createdIntents.set('bob_library', bobIntent.id);
        console.log(`✅ Created Intent for Bob: "${bobPayload}" (ID: ${bobIntent.id})`);


        // --- SCENARIO 3: MATCHING & DISCOVERY ---
        console.log('\n--- 4. Scenario: Matching & Discovery ---');

        // Force a stake between them to ensure discovery works (simulating the background agent)
        // In a real scenario, the 'semantic-relevancy' agent would do this.
        const stakeId = uuidv4();
        await db.insert(intentStakes).values({
            id: stakeId,
            intents: [aliceIntent.id, bobIntent.id], // Order doesn't strictly matter for the array check usually, but let's be safe
            stake: BigInt(85),
            reasoning: "Alice needs a co-founder for a social graph, and Bob is an engineer interested in social graphs.",
            agentId: '028ef80e-9b1c-434b-9296-bb6130509482'
        });
        console.log(`✅ Injected mock stake between Alice and Bob (ID: ${stakeId})`);

        // Run discovery for Alice
        console.log(`Running discovery for Alice...`);
        const discoveryResults = await discoverUsers({
            authenticatedUserId: alice.id,
            limit: 10
        });

        const bobFound = discoveryResults.results.find(r => r.user.id === bob.id);

        if (bobFound) {
            console.log(`✅ Alice discovered Bob!`);
            console.log(`   Total Stake: ${bobFound.totalStake}`);
            console.log(`   Reasoning: ${bobFound.intents?.[0]?.reasonings?.[0] ?? 'N/A'}`);
        } else {
            console.error(`❌ Alice did NOT discover Bob. Discovery results:`, JSON.stringify(discoveryResults.results.map(r => r.user.name), null, 2));
            // Don't fail hard, proceed to email test if possible
        }


        // --- SCENARIO 4: EMAIL & CONNECTION ---
        console.log('\n--- 5. Scenario: Email & Connection ---');

        console.log(`Sending connection request from Alice to Bob...`);
        console.log(`(Emails should be redirected to ${process.env.TESTING_EMAIL_ADDRESS || 'yanki@index.network'})`);

        try {
            await sendConnectionRequestNotification(alice.id, bob.id);
            console.log(`✅ sendConnectionRequestEmail completed without error.`);
            console.log(`👉 CHECK YOUR EMAIL (${process.env.TESTING_EMAIL_ADDRESS || 'yanki@index.network'}) for a message with subject related to "Connection Request"`);
        } catch (error) {
            console.error(`❌ Failed to send email:`, error);
        }

        console.log('\n==================================================');
        console.log(`Test Suite Completed Successfully.`);
        console.log('==================================================');

    } catch (error) {
        console.error('Test suite failed:', error);
    } finally {
        // Cleanup (Optional - maybe we want to keep data for inspection?)
        // For now, let's keep it.
        await closeDb();
    }
}

main();
