/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { searchUser } from './parallel';

async function runTests() {
    console.log("🧪 Starting Parallel Client Tests...\n");

    if (!process.env.PARALLELS_API_KEY) {
        console.warn("⚠️  PARALLELS_API_KEY not found in env. Skipping live API test.");
        // We can mock the fetch here if we want to test logic without API key, 
        // but for now let's just warn as this is an integration test file.
        return;
    }

    console.log("1️⃣  Test: Live Search (Casey Harper)");
    const objective = 'Casey Harper, "test-6285@example.com"';

    try {
        console.log(`Searching for: ${objective}...`);
        const result = await searchUser({ objective });
        console.log("Result:\n", JSON.stringify(result, null, 2));

        if (result && Array.isArray(result.results)) {
            console.log(`✅ Passed (Got ${result.results.length} results)`);
        } else {
            console.error("❌ Failed (Invalid response format)");
        }
    } catch (err) {
        console.error("❌ Error calling Parallel API:", err);
    }
}

runTests().catch(console.error);
