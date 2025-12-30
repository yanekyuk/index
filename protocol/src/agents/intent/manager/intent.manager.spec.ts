import * as dotenv from 'dotenv';
import path from 'path';
import { IntentManager } from './intent.manager';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

// Mock Data for Tests
const mockProfile = {
    userId: "test-user-123",
    identity: {
        name: "Test User",
        bio: "A software engineer interested in AI and crypto.",
        location: "San Francisco, CA"
    },
    attributes: {
        interests: ["AI", "Blockchain", "Rust"],
        skills: ["TypeScript", "Solidity"],
        goals: ["Build a startup"]
    }
};

const mockActiveIntents = [
    {
        id: "intent-1",
        description: "Learn Rust",
        status: "active" as const,
        created_at: Date.now()
    }
];

async function runTests() {
    console.log("🧪 Starting IntentManager Tests...");

    // Check for API keys
    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
        console.warn("⚠️  No API Key found. Live LLM tests might fail.");
    }

    const manager = new IntentManager();

    // Test 1: Full Flow - New Intent
    // "Learn Rust" is active. "Hire designer" is new.
    console.log("\n1️⃣  Test: Manager Process (New Intent)");
    try {
        const profileContext = `
            Bio: ${mockProfile.identity.bio}
            Location: ${mockProfile.identity.location}
            Interests: ${mockProfile.attributes.interests.join(', ')}
            Skills: ${mockProfile.attributes.skills.join(', ')}
            Goals: ${mockProfile.attributes.goals.join(', ')}
        `;

        const activeIntentsContext = mockActiveIntents.map(i => `ID: ${i.id}, Description: ${i.description}, Status: ${i.status}`).join('\n');

        const res1 = await manager.processIntent("I need to hire a designer", profileContext, mockActiveIntents, activeIntentsContext);
        console.log("Result:", JSON.stringify(res1, null, 2));

        if (res1.actions.some(a => a.type === 'create' && a.payload.toLowerCase().includes('designer'))) {
            console.log("✅ Passed (Manager successfully orchestrated creation)");
        } else {
            console.log("❌ Failed (Expected create action)");
        }
    } catch (err) {
        console.error("❌ Error:", err);
    }

    // Test 2: Full Flow - Duplicate/Ignore
    // "Learn Rust" is active. Input "I want to learn Rust".
    console.log("\n2️⃣  Test: Manager Process (Duplicate)");
    try {
        const profileContext = `
            Bio: ${mockProfile.identity.bio}
            Location: ${mockProfile.identity.location}
            Interests: ${mockProfile.attributes.interests.join(', ')}
            Skills: ${mockProfile.attributes.skills.join(', ')}
            Goals: ${mockProfile.attributes.goals.join(', ')}
        `;

        const activeIntentsContext = mockActiveIntents.map(i => `ID: ${i.id}, Description: ${i.description}, Status: ${i.status}`).join('\n');

        const res2 = await manager.processIntent("I want to learn Rust", profileContext, mockActiveIntents, activeIntentsContext);
        console.log("Result:", JSON.stringify(res2, null, 2));

        // Note: Our reconcile logic now updates if description is DIFFERENT.
        // If LLM returns exactly "Learn Rust", it might not trigger action.
        // If LLM returns "Learn Rust programming language", it might trigger Update.
        // We'll consider it a pass if it DOES NOT create a new duplicate.
        const createdDuplicates = res2.actions.filter(a => a.type === 'create' && a.payload.toLowerCase().includes('rust'));

        if (createdDuplicates.length === 0) {
            console.log("✅ Passed (No duplicate creation)");
        } else {
            console.log("❌ Failed (Duplicate created)");
        }
    } catch (err) {
        console.error("❌ Error:", err);
    }

    // Test 3: Full Flow - Expire
    console.log("\n3️⃣  Test: Manager Process (Expire)");
    try {
        const profileContext = `
            Bio: ${mockProfile.identity.bio}
            Location: ${mockProfile.identity.location}
            Interests: ${mockProfile.attributes.interests.join(', ')}
            Skills: ${mockProfile.attributes.skills.join(', ')}
            Goals: ${mockProfile.attributes.goals.join(', ')}
        `;

        const activeIntentsContext = mockActiveIntents.map(i => `ID: ${i.id}, Description: ${i.description}, Status: ${i.status}`).join('\n');

        const res3 = await manager.processIntent("I'm done with learning Rust, I hate it", profileContext, mockActiveIntents, activeIntentsContext);
        console.log("Result:", JSON.stringify(res3, null, 2));

        if (res3.actions.some(a => a.type === 'expire' && a.id === 'intent-1')) {
            console.log("✅ Passed (Expire action triggered)");
        } else {
            console.log("❌ Failed (Expected expire action)");
        }
    } catch (err) {
        console.error("❌ Error:", err);
    }

    // Test 4: Full Flow - Update
    console.log("\n4️⃣  Test: Manager Process (Update)");
    try {
        const profileContext = `
            Bio: ${mockProfile.identity.bio}
            Location: ${mockProfile.identity.location}
            Interests: ${mockProfile.attributes.interests.join(', ')}
            Skills: ${mockProfile.attributes.skills.join(', ')}
            Goals: ${mockProfile.attributes.goals.join(', ')}
        `;

        const activeIntentsContext = mockActiveIntents.map(i => `ID: ${i.id}, Description: ${i.description}, Status: ${i.status}`).join('\n');

        // "Learn Rust" is active. User provides more detail.
        const res4 = await manager.processIntent("I want to really master Rust and build systems with it", profileContext, mockActiveIntents, activeIntentsContext);
        console.log("Result:", JSON.stringify(res4, null, 2));

        if (res4.actions.some(a => a.type === 'update' && a.id === 'intent-1')) {
            console.log("✅ Passed (Update action triggered)");
        } else {
            console.log("❌ Failed (Expected update action)");
        }
    } catch (err) {
        console.error("❌ Error:", err);
    }

    // Test 5: Full Flow - Explicit Ignore
    console.log("\n5️⃣  Test: Manager Process (Explicit Ignore)");
    try {
        // Use a local active intent that matches what the inferrer prefers ("Learn Rust programming")
        // to ensure we test the IGNORE path, not the trivial UPDATE path.
        const perfectMatchIntents = [{
            id: "intent-1",
            description: "Learn Rust programming",
            status: "active" as const,
            created_at: Date.now()
        }];

        // Exact same intent as active

        const profileContext = `
            Bio: ${mockProfile.identity.bio}
            Location: ${mockProfile.identity.location}
            Interests: ${mockProfile.attributes.interests.join(', ')}
            Skills: ${mockProfile.attributes.skills.join(', ')}
            Goals: ${mockProfile.attributes.goals.join(', ')}
        `;

        const activeIntentsContext = perfectMatchIntents.map(i => `ID: ${i.id}, Description: ${i.description}, Status: ${i.status}`).join('\n');

        const res5 = await manager.processIntent("I want to learn Rust", profileContext, perfectMatchIntents, activeIntentsContext);
        console.log("Result:", JSON.stringify(res5, null, 2));

        if (res5.actions.length === 0) {
            console.log("✅ Passed (Ignored duplicate correctly)");
        } else {
            console.log("❌ Failed (Expected NO actions, got: " + JSON.stringify(res5.actions) + ")");
        }
    } catch (err) {
        console.error("❌ Error:", err);
    }
}

runTests().catch(console.error);
