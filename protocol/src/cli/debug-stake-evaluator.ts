import * as dotenv from 'dotenv';
import path from 'path';
import { StakeEvaluator } from '../agents/intent/stake/evaluator/stake.evaluator';

// Load env
const envPath = path.resolve(__dirname, '../../.env.development');
console.log(`Loading env from: ${envPath}`);
dotenv.config({ path: envPath });

async function runDebug() {
  console.log("🧪 Starting StakeEvaluator Debug...");

  // Use the same config as production (gpt-4o)
  const matcher = new StakeEvaluator({ model: 'openai/gpt-4o' });

  const primaryIntent = {
    id: "investor-1",
    payload: "I want to fund a video game production focusing on immersion."
  };

  const candidates = [
    {
      id: "creator-1",
      payload: "I want to make video games that focus on immersion."
    }
  ];

  console.log(`\nPrimary: "${primaryIntent.payload}"`);
  console.log(`Candidate: "${candidates[0].payload}"`);

  const result = await matcher.run(primaryIntent, candidates);

  console.log("\nMatches Found:", result.matches.length);
  result.matches.forEach((m) => {
    console.log(`   - [Score: ${m.confidence}] Matches ${m.candidateIntentId}`);
    console.log(`     Reasoning: ${m.reason}`);
    console.log(`     IsMatch: ${m.isMatch}`);
  });

  if (result.matches.length === 0) {
    console.log("\n❌ FAILED: No match found.");
  } else {
    console.log("\n✅ PASSED: Match found.");
  }
}

runDebug().catch(console.error);
