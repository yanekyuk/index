import * as dotenv from 'dotenv';
import path from 'path';
import { ProfileGenerator } from './profile.generator';
import { IndexEmbedder } from '../../lib/embedder';
import { ProfileGeneratorOutput } from './profile.generator.types';
import { searchUser } from '../../lib/parallel/parallel';
import { json2md } from '../../lib/json2md/json2md';
// Load env
const envPath = path.resolve(__dirname, '../../../.env.development');
dotenv.config({ path: envPath });

async function runTests() {
  console.log("🧪 Starting ProfileGenerator Tests...\n");

  const embedder = new IndexEmbedder();
  const generator = new ProfileGenerator(embedder);
  const parallelData = await searchUser({
    objective: `
            Find information about the person named Seref Yarar.
            This is their LinkedIn profile page: https://www.linkedin.com/in/serefyarar/
            This is their email address: seref@index.network
            This is their GitHub profile page: https://github.com/serefyarar
            This is their Twitter profile page: https://x.com/hyperseref
        `
  });
  console.log("1️⃣  Test: Generate Profile from Mock Data");
  try {
    const result = await generator.run(json2md.fromObject(parallelData.results.map((result) => ({ title: result.title, content: result.excerpts.join('\n') }))));
    console.log("Generated Profile:\n", JSON.stringify(result, null, 2));

    const hasBio = !!result.profile.identity.bio;
    const hasLocation = !!result.profile.identity.location;
    const hasInterests = result.profile.attributes.interests.length > 0;
    const hasNarrative = !!result.profile.narrative.context && !!result.profile.narrative.aspirations;
    const hasEmbedding = !!result.embedding && result.embedding.length > 0;

    if (hasBio && hasLocation && hasInterests && hasNarrative && hasEmbedding) {
      console.log("✅ Passed (Profile generated with all required fields + embedding)");
    } else {
      console.error("❌ Failed (Missing some fields)");
      if (!hasBio) console.error(" - Missing Bio");
      if (!hasLocation) console.error(" - Missing Location");
      if (!hasInterests) console.error(" - Missing Interests");
      if (!hasNarrative) console.error(" - Missing Narrative");
      if (!hasEmbedding) console.error(" - Missing Embedding");
    }

  } catch (err) {
    console.error("❌ Error running ProfileGenerator:", err);
  }
}

runTests().catch(console.error);
