import * as dotenv from 'dotenv';
import path from 'path';
import { processIntent } from './intent.manager';

// Load env
const envPath = path.resolve(__dirname, '../../../../../.env.development');
dotenv.config({ path: envPath });

// Mock Data for Tests
const mockProfile = {
    userId: "test-user-123",
    identity: {
        name: "Test User",
        bio: "A software engineer interested in AI and crypto."
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
    
    // Test 1: Full Flow - New Intent
    // "Learn Rust" is active. "Hire designer" is new.
    console.log("\n1️⃣  Test: Manager Process (New Intent)");
    try {
        const res1 = await processIntent("I need to hire a designer", mockProfile, mockActiveIntents);
        console.log("Result:", JSON.stringify(res1, null, 2));
        
        if (res1.actions.some(a => a.type === 'create' && a.payload.toLowerCase().includes('designer'))) {
             console.log("✅ Passed (Manager successfully orchestrated creation)");
        } else {
             console.log("❌ Failed (Expected create action)");
        }
    } catch (err) {
        console.error("❌ Error:", err);
    }

    // Test 2: Full Flow - Duplicate
    // "Learn Rust" is active. Input "I want to learn Rust".
    console.log("\n2️⃣  Test: Manager Process (Duplicate)");
    try {
        const res2 = await processIntent("I want to learn Rust", mockProfile, mockActiveIntents);
        console.log("Result:", JSON.stringify(res2, null, 2));

        if (res2.actions.length === 0) {
             console.log("✅ Passed (Manager successfully orchestrated duplicate detection)");
        } else {
             console.log("❌ Failed (Expected no actions)");
        }
    } catch (err) {
        console.error("❌ Error:", err);
    }
}

runTests().catch(console.error);
