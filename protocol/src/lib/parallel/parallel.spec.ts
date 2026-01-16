import * as dotenv from 'dotenv';
import path from 'path';
import { searchUser } from './parallel';

// Load env
const envPath = path.resolve(__dirname, '../../../.env.development');
dotenv.config({ path: envPath });

async function runTests() {
    console.log("🧪 Starting Parallel Client Tests...\n");

    if (!process.env.PARALLELS_API_KEY) {
        console.warn("⚠️  PARALLELS_API_KEY not found in env. Skipping live API test.");
        // We can mock the fetch here if we want to test logic without API key, 
        // but for now let's just warn as this is an integration test file.
        return;
    }

    console.log("1️⃣  Test: Live Search (Casey Harper)");
    const objective = 'Casey Harper, "test-6285@privy.io"';

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
