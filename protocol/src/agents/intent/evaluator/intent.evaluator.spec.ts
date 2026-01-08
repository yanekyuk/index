import * as dotenv from 'dotenv';
import path from 'path';
import { IntentEvaluator } from './intent.evaluator';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

async function runTests() {
  console.log("🧪 Starting IntentEvaluator Tests...");

  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("⚠️  No OPENROUTER_API_KEY found. Live LLM tests might fail.");
  }

  const evaluator = new IntentEvaluator();

  // Test 1: Highly Appropriate Fit
  console.log("\n1️⃣  Test: Highly Appropriate Fit");
  try {
    const intent = "I want to learn how to build autonomous agents";
    const indexPrompt = "A community for builders and researchers working on autonomous AI agents.";
    const memberPrompt = "Interested in AI, agents, and LLMs.";

    const res = await evaluator.evaluate(intent, indexPrompt, memberPrompt, "test");
    console.log("Result:", JSON.stringify(res, null, 2));

    if (res && res.indexScore > 0.8 && res.memberScore > 0.8) {
      console.log("✅ Passed (High scores as expected)");
    } else {
      console.log("❌ Failed (Expected high scores)");
    }
  } catch (err) {
    console.error("❌ Error:", err);
  }

  // Test 2: Poor Index Fit
  console.log("\n2️⃣  Test: Poor Index Fit");
  try {
    const intent = "Selling my old car";
    const indexPrompt = "A community for builders and researchers working on autonomous AI agents.";
    const memberPrompt = "Interested in AI, agents, and LLMs.";

    const res = await evaluator.evaluate(intent, indexPrompt, memberPrompt, "test");
    console.log("Result:", JSON.stringify(res, null, 2));

    if (res && res.indexScore < 0.3) {
      console.log("✅ Passed (Low index score as expected)");
    } else {
      console.log("❌ Failed (Expected low index score)");
    }
  } catch (err) {
    console.error("❌ Error:", err);
  }

  // Test 3: Good Index Fit, Poor Member Fit
  console.log("\n3️⃣  Test: Good Index Fit, Poor Member Fit");
  try {
    const intent = "Looking for co-founders for a crypto trading bot";
    const indexPrompt = "A place to find co-founders for tech startups.";
    const memberPrompt = "I am strictly interested in biotech and health tech. No crypto.";

    const res = await evaluator.evaluate(intent, indexPrompt, memberPrompt, "test");
    console.log("Result:", JSON.stringify(res, null, 2));

    if (res && res.indexScore >= 0.7 && res.memberScore < 0.3) {
      console.log("✅ Passed (High index score, low member score)");
    } else {
      console.log("❌ Failed (Expected high index score, low member score)");
    }
  } catch (err) {
    console.error("❌ Error:", err);
  }

  // Test 4: Missing Member Prompt
  console.log("\n4️⃣  Test: Missing Member Prompt");
  try {
    const intent = "Just hanging out";
    const indexPrompt = "General chat.";

    // @ts-ignore
    const res = await evaluator.evaluate(intent, indexPrompt, null, "test");
    console.log("Result:", JSON.stringify(res, null, 2));

    if (res && res.memberScore === 0) {
      console.log("✅ Passed (Member score 0 as expected)");
    } else {
      console.log("❌ Failed (Expected member score 0)");
    }
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

runTests().catch(console.error);
