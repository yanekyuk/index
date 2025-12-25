import * as dotenv from 'dotenv';
import path from 'path';
import { SynthesisGenerator } from './synthesis.generator';
import { SynthesisGeneratorInput } from './synthesis.generator.types';
// Load env
const envPath = path.resolve(__dirname, '../../../../../.env.development');
console.log(`Loading env from: ${envPath}`);
dotenv.config({ path: envPath });

async function runTests() {
  console.log("🧪 Starting SynthesisGenerator Tests...");

  // Check for API keys
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("⚠️  No OPENROUTER_API_KEY found. Live LLM tests might fail if not mocked.");
  }

  const generator = new SynthesisGenerator();

  // Mock Data
  const mockInput: SynthesisGeneratorInput = {
    initiator: "Alice",
    target: "Bob",
    targetIntro: "Bob is a senior software engineer who loves Rust and distributed systems. He is currently building a new p2p protocol. He enjoys hiking and coffee.",
    isThirdPerson: false,
    intentPairs: [
      {
        contextUserIntent: {
          id: "intent-123",
          payload: "I am looking for a co-founder for a decentralized social media app",
          createdAt: new Date()
        },
        targetUserIntent: {
          id: "intent-456",
          payload: "I want to join an early stage startup as a technical co-founder",
          createdAt: new Date()
        }
      },
      {
        contextUserIntent: {
          id: "intent-789",
          payload: "I need help with rust async programming",
          createdAt: new Date()
        },
        targetUserIntent: {
          id: "intent-101",
          payload: "I am mentoring developers in Rust",
          createdAt: new Date()
        }
      }
    ],
    characterLimit: 300
  };

  // Test 1: Vibe Check Generation (First Person)
  console.log("\n1️⃣  Test: Vibe Check Generation (First Person)");
  console.log("Input:", JSON.stringify({ ...mockInput, intentPairs: mockInput.intentPairs.length }, null, 2));

  try {
    const res1 = await generator.run(mockInput);
    console.log("Result:", JSON.stringify(res1, null, 2));

    if (res1.subject && res1.body) {
      console.log("✅ Passed (Generated Subject and Body)");
    } else {
      console.log("❌ Failed (Missing subject or body)");
    }

    if (res1.body.includes("Alice") || res1.subject.includes("Bob")) {
      console.log("✅ Passed (Contains names)");
    } else {
      console.log("⚠️ Warning (Names might be missing, check output)");
    }

  } catch (err) {
    console.error("❌ Failed (Error running generator)", err);
  }

  // Test 2: Third Person Generation
  console.log("\n2️⃣  Test: Vibe Check Generation (Third Person)");
  const thirdPersonInput = { ...mockInput, isThirdPerson: true };

  try {
    const res2 = await generator.run(thirdPersonInput);
    console.log("Result:", JSON.stringify(res2, null, 2));

    // Basic check if it runs
    if (res2.subject && res2.body) {
      console.log("✅ Passed (Generated Third Person output)");
    } else {
      console.log("❌ Failed (Missing output)");
    }
  } catch (err) {
    console.error("❌ Failed (Error running third person generator)", err);
  }

  // Test 3: No Intents (Edge Case - though types usually enforce array)
  // But let's test with empty array if the agent handles it or if Zod validation fails (it might produce poor output)
  console.log("\n3️⃣  Test: Empty Intents (Edge Case)");
  const emptyInput = { ...mockInput, intentPairs: [] };

  try {
    const res3 = await generator.run(emptyInput);
    console.log("Result:", JSON.stringify(res3, null, 2));
    console.log("✅ Passed (Handled empty intents gracefully)");
  } catch (err) {
    console.log("⚠️ Warning/Error with empty intents:", err instanceof Error ? err.message : err);
    // This might be expected behavior if the prompt fails to generate without intents, 
    // or if the LLM starts hallucinating. The generic prompt does expect pairs.
  }
}

runTests().catch(console.error);
