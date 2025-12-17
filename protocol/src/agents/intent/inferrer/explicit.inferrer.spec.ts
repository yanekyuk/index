import * as dotenv from 'dotenv';
import path from 'path';
import { ExplicitIntentDetector } from './explicit.inferrer';
import { UserMemoryProfile, ActiveIntent } from '../manager/intent.manager.types';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
console.log(`Loading env from: ${envPath}`);
dotenv.config({ path: envPath });

async function runTests() {
    console.log("🧪 Starting ExplicitIntentDetector Tests...");
    
    // Check for API keys (generic check, could be OpenAI, Anthropic, etc used by base agent)
    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
        console.warn("⚠️  No API Key found (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY). Live LLM tests might fail if not mocked.");
    }

    const detector = new ExplicitIntentDetector();

    // Mock Data
    const profile: UserMemoryProfile = {
        userId: "test-user",
        identity: { name: "Test User", bio: "Dev" },
        attributes: { interests: ["Coding"], skills: [], goals: [] }
    };

    const activeIntents: ActiveIntent[] = [
        { id: "1", description: "Learn Rust", status: "active", created_at: Date.now() }
    ];

    // Test 1: Duplicate
    console.log("\n1️⃣  Test: Duplicate Detection");
    console.log("Input: 'I want to learn Rust'");
    const res1 = await detector.run("I want to learn Rust", profile, activeIntents);
    console.log("Result:", JSON.stringify(res1, null, 2));
    if (res1.actions.length === 0) console.log("✅ Passed (No actions)");
    else console.log("❌ Failed (Expected no actions)");

    // Test 2: New Intent
    console.log("\n2️⃣  Test: New Intent");
    console.log("Input: 'I need to hire a designer'");
    const res2 = await detector.run("I need to hire a designer", profile, activeIntents);
    console.log("Result:", JSON.stringify(res2, null, 2));
    if (res2.actions.some(a => a.type === 'create')) console.log("✅ Passed (Create action found)");
    else console.log("❌ Failed (Expected create action)");

    // Test 3: Update Intent
    console.log("\n3️⃣  Test: Update Intent");
    console.log("Input: 'Actually, I want to learn Advanced Rust'");
    const res3 = await detector.run("Actually, I want to learn Advanced Rust", profile, activeIntents);
    console.log("Result:", JSON.stringify(res3, null, 2));
    if (res3.actions.some(a => a.type === 'update')) console.log("✅ Passed (Update action found)");
    else console.log("❌ Failed (Expected update action)");

    // Test 4: Expire Intent
    console.log("\n4️⃣  Test: Expire Intent");
    console.log("Input: 'I finished learning Rust'");
    const res4 = await detector.run("I finished learning Rust", profile, activeIntents);
    console.log("Result:", JSON.stringify(res4, null, 2));
    if (res4.actions.some(a => a.type === 'expire')) console.log("✅ Passed (Expire action found)");
    else console.log("❌ Failed (Expected expire action)");
}

runTests().catch(console.error);
