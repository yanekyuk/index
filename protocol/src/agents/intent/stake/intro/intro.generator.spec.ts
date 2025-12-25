import { IntroGenerator } from './intro.generator';
import { IntroGeneratorInput } from './intro.generator.types';
import dotenv from 'dotenv';
import path from 'path';

// Load env
const envPath = path.resolve(__dirname, '../../../../../.env.development');
console.log(`Loading env from: ${envPath}`);
dotenv.config({ path: envPath });

async function runTests() {
  const generator = new IntroGenerator();

  const mockInput: IntroGeneratorInput = {
    sender: {
      name: "Alice",
      reasonings: [
        "Interested in AI Agents",
        "Building a protocol for decentralized compute"
      ]
    },
    recipient: {
      name: "Bob",
      reasonings: [
        "Investing in AI Infrastructure",
        "Looking for fresh protocols"
      ]
    }
  };

  // Test 1: Standard Generation
  console.log("\n1️⃣  Test: Standard Generation");
  try {
    const result = await generator.run(mockInput);
    console.log("✅ Result:", JSON.stringify(result, null, 2));

    if (!result.synthesis || result.synthesis.length < 10) {
      throw new Error("Output too short");
    }
  } catch (error) {
    console.error("❌ Test 1 Failed:", error);
  }

  // Test 2: Sparse Data
  console.log("\n2️⃣  Test: Sparse Data");
  const sparseInput: IntroGeneratorInput = {
    sender: { name: "Mystery User", reasonings: ["Tech"] },
    recipient: { name: "Anon", reasonings: ["Crypto"] }
  };

  try {
    const result = await generator.run(sparseInput);
    console.log("✅ Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("❌ Test 2 Failed:", error);
  }

}

runTests().catch(console.error);
