import * as dotenv from 'dotenv';
import path from 'path';
import { IntentAuditor } from './intent.auditor';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

async function runTests() {
  console.log("🧪 Starting IntentAuditor Tests...");

  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("⚠️  No OPENROUTER_API_KEY found. Live LLM tests might fail.");
  }

  const auditor = new IntentAuditor();

  // Test 1: Explicit Expiration (Past Date)
  console.log("\n1️⃣  Test: Explicit Expiration (Past Date)");
  try {
    const expiredContent = "I need a ticket for the conference happening on Jan 1st 2020";
    const context = "Current Date: 2025-01-05";

    const res = await auditor.run(expiredContent, context);
    console.log("Result:", JSON.stringify(res, null, 2));

    if (res && res.isExpired && res.confidenceScore > 80) {
      console.log("✅ Passed (Correctly identified as expired)");
    } else {
      console.log("❌ Failed (Expected isExpired=true with high confidence)");
    }
  } catch (err) {
    console.error("❌ Error:", err);
  }

  // Test 2: Valid Intent (Future/Recent)
  console.log("\n2️⃣  Test: Valid Intent");
  try {
    const validContent = "I am looking for a co-founder for my new AI startup";
    const context = "Current Date: 2025-01-05. Intent created 2 days ago.";

    const res = await auditor.run(validContent, context);
    console.log("Result:", JSON.stringify(res, null, 2));

    if (res && !res.isExpired) {
      console.log("✅ Passed (Correctly identified as valid)");
    } else {
      console.log("❌ Failed (Expected isExpired=false)");
    }
  } catch (err) {
    console.error("❌ Error:", err);
  }

  // Test 3: Implicit Expiration (Stale Job Search)
  console.log("\n3️⃣  Test: Implicit Expiration (Stale Job Search)");
  try {
    const staleContent = "Looking for a summer internship";
    const context = "Current Date: 2025-10-01. Intent created in March 2025.";

    const res = await auditor.run(staleContent, context);
    console.log("Result:", JSON.stringify(res, null, 2));

    if (res && res.isExpired) {
      console.log("✅ Passed (Correctly identified as stale)");
    } else {
      console.log("❌ Failed (Expected isExpired=true)");
    }
  } catch (err) {
    console.error("❌ Error:", err);
  }

  // Test 4: Intro Incompatibility
  console.log("\n4️⃣  Test: Intro Incompatibility");
  try {
    const content = "Looking to get hired as a junior frontend dev";
    const context = `
      Current Date: 2025-01-05.
      User Intro: "Senior Backend Engineer at Google with 10 years of experience."
    `;

    const res = await auditor.run(content, context);
    console.log("Result:", JSON.stringify(res, null, 2));

    if (res && res.isExpired) {
      console.log("✅ Passed (Correctly identified incompatibility)");
    } else {
      console.log("❌ Failed (Expected isExpired=true due to incompatibility)");
    }
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

runTests().catch(console.error);
