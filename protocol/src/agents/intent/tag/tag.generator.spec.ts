import * as dotenv from 'dotenv';
import path from 'path';
import { IntentTagGenerator } from './tag.generator';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

async function runTests() {
  console.log("🧪 Starting IntentTagGenerator Tests...");

  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("⚠️  No OPENROUTER_API_KEY found. Live LLM tests might fail.");
  }

  const generator = new IntentTagGenerator();

  // Test 1: Generate tags from job search intents
  console.log("\n1️⃣  Test: Job Search Intents");
  try {
    const intents = [
      "Looking for a frontend developer role",
      "Hiring a senior react engineer",
      "Seeking remote web dev contracts"
    ];

    const res = await generator.run(intents);
    console.log("Result:", JSON.stringify(res, null, 2));

    if (res && res.suggestions.length > 0) {
      const hasDevTag = res.suggestions.some(t => t.value.includes('dev') || t.value.includes('engineer') || t.value.includes('react'));
      if (hasDevTag) {
        console.log("✅ Passed (Generated relevant developer tags)");
      } else {
        console.log("❌ Failed (Did not generate relevant developer tags)");
      }
    } else {
      console.log("❌ Failed (No suggestions generated)");
    }
  } catch (err) {
    console.error("❌ Error:", err);
  }

  // Test 2: Generate tags with specific user prompt
  console.log("\n2️⃣  Test: With User Prompt 'Crypto'");
  try {
    const intents = [
      "Building a DeFi protocol",
      "Looking for solidity devs",
      "Investing in new L1 chains",
      "Hiring for my AI startup"
    ];
    const userPrompt = "Focus on crypto and blockchain";

    const res = await generator.run(intents, userPrompt);
    console.log("Result:", JSON.stringify(res, null, 2));

    if (res && res.suggestions.length > 0) {
      const hasCryptoTag = res.suggestions.some(t => t.value.includes('defi') || t.value.includes('crypto') || t.value.includes('blockchain'));
      if (hasCryptoTag) {
        console.log("✅ Passed (Generated focused crypto tags)");
      } else {
        console.log("❌ Failed (Did not generate focused crypto tags)");
      }
    } else {
      console.log("❌ Failed (No suggestions generated)");
    }
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

runTests().catch(console.error);
