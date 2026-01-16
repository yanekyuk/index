import { describe, test, expect, beforeAll } from 'bun:test';
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
    context: "Want to learn Rust and build a DAO."
  },
  attributes: {
    interests: ["coding"],
    skills: ["javascript"],
    values: ["open source"],
    personality: ["curious"]
  }
} as any;

describe('ImplicitInferrer Tests', () => {
  test('Name Exclusion Test', async () => {

    const inferrer = new ImplicitInferrer();

    // Input context intentionally contains a specific name
    const context = "Opportunity: Collaborate with Alice Wonderland to build a Rust-based DeFi platform. Reason: Strong skill match.";

    const profileContext = `
      Bio: ${mockProfile.identity.bio}
      Location: ${mockProfile.identity.location}
      Interests: ${mockProfile.attributes.interests.join(', ')}
      Skills: ${mockProfile.attributes.skills.join(', ')}
    `;

    const result = await inferrer.run(profileContext, context);

    expect(result).not.toBeNull();


    const bannedName = "Alice";
    const hasBannedName = result!.payload.includes(bannedName) || result!.payload.includes("Wonderland");
    expect(hasBannedName).toBe(false);
  });
});
