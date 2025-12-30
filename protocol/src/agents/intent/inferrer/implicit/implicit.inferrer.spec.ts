import * as dotenv from 'dotenv';
import path from 'path';
import { ImplicitInferrer } from './implicit.inferrer';
import { UserMemoryProfile } from '../../manager/intent.manager.types';

// Load env
const envPath = path.resolve(__dirname, '../../../../../.env.development');
dotenv.config({ path: envPath });

const mockProfile: UserMemoryProfile = {
  userId: "test-user",
  identity: {
    name: "Bob Builder",
    bio: "I am a software engineer looking to build decentralized apps.",
    location: "San Francisco"
  },
  narrative: {
    aspirations: "Want to learn Rust and build a DAO."
  },
  attributes: {
    interests: ["coding"],
    skills: ["javascript"],
    values: ["open source"],
    personality: ["curious"]
  }
} as any; // Cast as any if other optional fields are annoying, but filling these helps.

async function runTest() {
  console.log("🧪 Starting ImplicitInferrer Name Exclusion Test...");

  const inferrer = new ImplicitInferrer();

  // Input context intentionally contains a specific name
  const context = "Opportunity: Collaborate with Alice Wonderland to build a Rust-based DeFi platform. Reason: Strong skill match.";

  try {
    const profileContext = `
      Bio: ${mockProfile.identity.bio}
      Location: ${mockProfile.identity.location}
      Interests: ${mockProfile.attributes.interests.join(', ')}
      Skills: ${mockProfile.attributes.skills.join(', ')}
      Aspirations: ${mockProfile.narrative?.aspirations || ''}
    `;

    const result = await inferrer.run(profileContext, context);

    if (!result) {
      console.error("❌ Test Failed: No result returned.");
      return;
    }

    console.log(`\nInput Context: "${context}"`);
    console.log(`Output Intent: "${result.payload}"`);

    const bannedName = "Alice";
    if (result.payload.includes(bannedName) || result.payload.includes("Wonderland")) {
      console.error(`❌ Test Failed: Intent contains specific name "${bannedName}".`);
      process.exit(1);
    } else {
      console.log("✅ Passed: Intent does not contain the specific name.");
    }

  } catch (error) {
    console.error("❌ Test Error:", error);
  }
}

runTest();
