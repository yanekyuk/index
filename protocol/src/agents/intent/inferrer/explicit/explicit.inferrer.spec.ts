import * as dotenv from 'dotenv';
import path from 'path';
import { ExplicitIntentDetector } from './explicit.inferrer';
import { UserMemoryProfile, ActiveIntent } from '../../manager/intent.manager.types';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
console.log(`Loading env from: ${envPath}`);
dotenv.config({ path: envPath });

async function runTests() {
    console.log("🧪 Starting ExplicitIntentDetector Tests...");

    // Check for API keys (generic check, could be OpenAI, Anthropic, etc used by base agent)
    if (!process.env.OPENROUTER_API_KEY) {
        console.warn("⚠️  No API Key found (OPENROUTER_API_KEY). Live LLM tests might fail if not mocked.");
    }

    const detector = new ExplicitIntentDetector();

    // Mock Data
    const profile: UserMemoryProfile = {
        userId: "test-user",
        identity: { name: "Test User", bio: "Dev", location: "Earth" },
        attributes: { interests: ["Coding"], skills: [], goals: [] },
        narrative: { context: "Context", aspirations: "Aspirations" }
    };

    // Test 1: Inference
    console.log("\n1️⃣  Test: Goal Inference");
    console.log("Input: 'I want to learn Rust'");
    // Note: Inferrer doesn't know about active intents anymore
    const profileContext = `
    Bio: ${profile.identity.bio}
    Location: ${profile.identity.location}
    Interests: ${profile.attributes.interests.join(', ')}
    Skills: ${profile.attributes.skills.join(', ')}
    Aspirations: ${profile.narrative?.aspirations || ''}
    `;

    const res1 = await detector.run("I want to learn Rust", profileContext);
    console.log("Result:", JSON.stringify(res1, null, 2));

    if (res1.intents.some(i => i.type === 'goal' && i.description.toLowerCase().includes('rust'))) {
        console.log("✅ Passed (Goal inferred)");
    } else {
        console.log("❌ Failed (Expected goal inference)");
    }

    // Test 2: Tombstone Inference
    console.log("\n2️⃣  Test: Tombstone Inference");
    console.log("Input: 'I finished learning Rust'");
    const res2 = await detector.run("I finished learning Rust", profileContext);
    console.log("Result:", JSON.stringify(res2, null, 2));

    if (res2.intents.some(i => i.type === 'tombstone')) {
        console.log("✅ Passed (Tombstone inferred)");
    } else {
        console.log("❌ Failed (Expected tombstone inference)");
    }

    // Test 3: No Content (Bootstrap from Profile)
    console.log("\n3️⃣  Test: Bootstrap from Profile");
    const res3 = await detector.run(null, profileContext);
    console.log("Result:", JSON.stringify(res3, null, 2));

    // Should infer something from "Aspirations: Aspirations" or "Interests: Coding"
    if (res3.intents.length > 0) {
        console.log("✅ Passed (Inferred from profile)");
    } else {
        console.log("⚠️ Warning (Nothing inferred from mock profile - might depend on LLM, check logs)");
    }
}

runTests().catch(console.error);
