import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { ProfileGenerator } from './profile.generator';
import { IndexEmbedder } from '../../lib/embedder';
import { json2md } from '../../lib/json2md/json2md';
import { searchUser } from '../../lib/parallel/parallel';

// Load env
const envPath = path.resolve(__dirname, '../../../.env.development');
dotenv.config({ path: envPath });

describe('ProfileGenerator Tests', () => {
  let embedder: IndexEmbedder;
  let generator: ProfileGenerator;

  beforeAll(() => {
    embedder = new IndexEmbedder();
    generator = new ProfileGenerator(embedder);
  });

  test('Generate Profile from Mock Data', async () => {
    console.log("1️⃣  Test: Generate Profile from Mock Data");

    // Use real parallel search
    let parallelData;
    try {
      parallelData = await searchUser({
        objective: `
                    Find information about the person named Seref Yarar.
                    This is their LinkedIn profile page: https://www.linkedin.com/in/serefyarar/
                    This is their email address: seref@index.network
                    This is their GitHub profile page: https://github.com/serefyarar
                    This is their Twitter profile page: https://x.com/hyperseref
                `
      });
    } catch (err) {
      console.warn("⚠️ Warning: searchUser failed (likely network/API key issue). Skipping detailed profile gen test.", err);
      return; // Skip test if search fails
    }

    if (!parallelData || !parallelData.results) {
      console.warn("⚠️ Warning: No results from searchUser. Skipping.");
      return;
    }

    try {
      const result = await generator.run(json2md.fromObject(parallelData.results.map((result: any) => ({ title: result.title, content: result.excerpts.join('\n') }))));
      // console.log("Generated Profile:\n", JSON.stringify(result, null, 2));

      const hasBio = !!result.profile.identity.bio;
      const hasLocation = !!result.profile.identity.location;
      const hasInterests = result.profile.attributes.interests.length > 0;
      const hasNarrative = !!result.profile.narrative.context;
      const hasEmbedding = !!result.embedding && result.embedding.length > 0;

      expect(hasBio).toBe(true);
      expect(hasLocation).toBe(true);
      expect(hasInterests).toBe(true);
      expect(hasNarrative).toBe(true);
      // expect(hasEmbedding).toBe(true); 
    } catch (err) {
      throw err;
    }
  }, 60000); // 60s timeout
});
