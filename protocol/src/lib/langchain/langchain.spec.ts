import { AgentRequest, NextHandler, createAgent, createMiddleware } from "./langchain";
import { AIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

// Mock environment variables for testing
// process.env.OPENROUTER_API_KEY = "test-key";

console.log("🧪 Testing LangChain Middleware...\n");

async function testLangChain() {
  // 1. Test Exports Existence
  console.log("1️⃣  Test: Exports Existence");
  if (typeof createMiddleware === 'function' && typeof createAgent === 'function') {
    console.log("✅ createMiddleware and createAgent are functions");
  } else {
    console.error("❌ Failed: Exports missing");
  }

  // 2. Test Middleware Logic
  console.log("\n2️⃣  Test: Middleware Execution");

  const testMiddleware = createMiddleware({
    name: "TestMiddleware",
    wrapModelCall: async (request: AgentRequest, next: NextHandler) => {
      console.log("   -> Middleware Intercepting");
      // Modify request or just pass through
      return await next(request);
    }
  });

  const agent = createAgent({
    model: "openai/gpt-4o-mini",
    middleware: [testMiddleware]
  });

  // Mocking invoke to avoid actual API call in unit test environment without valid key
  // In a real test we'd mock ChatOpenAI.prototype.invoke
  try {
    console.log("   -> Invoking agent (expecting failure due to invalid key, but middleware log should appear)");
    // This will likely fail network call, but we check logs
    await agent.invoke([{ role: "user", content: "hello" }]);
  } catch (e: any) {
    if (e.message.includes("401") || e.message.includes("key")) {
      console.log("✅ Agent invoked (Network error expected)");
    } else {
      console.log(`ℹ️ Agent invoke result: ${e.message}`);
    }
  }
}

testLangChain().catch(console.error);
