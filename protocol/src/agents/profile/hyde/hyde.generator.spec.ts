import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { HydeGeneratorAgent } from './hyde.generator';
import { UserMemoryProfile } from '../../intent/manager/intent.manager.types';
import { IndexEmbedder } from '../../../lib/embedder';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

// Mock Source Profile
const mockProfile: UserMemoryProfile = {
  userId: "testtesttest",
  "identity": {
    "name": "Seref Yarar",
    "bio": "Seref Yarar is currently the Co-Founder at Index Network, leveraging his extensive background in engineering to drive forward technological innovations, particularly focused on user privacy and decentralized networks.",
    "location": "Brooklyn, New York, United States"
  },
  "narrative": {
    "context": "Seref Yarar, based in Brooklyn, New York, operates in a dynamic and evolving tech landscape. He holds a strong academic background in Computer Engineering from Bahcesehir University. Initially making his mark as a Software Engineer and subsequently a Head of Engineering, Seref moved on to co-found GoWit Technology, where he held the role of CTO, developing advanced retail media advertisement platforms. Now, as the Co-Founder of Index Network, he leverages his engineering expertise to innovate within decentralized networks, focusing on custom search engines and data privacy protocols. His work involves collaboration with decentralized protocols and platforms such as Lit Protocol and Ceramic Network, aiming to empower users by giving them control over their data and interactions with digital content."
  },
  "attributes": {
    "goals": [
      "innovate within decentralized networks",
      "empower users by giving them control over their data and interactions with digital content"
    ],
    "interests": [
      "autonomous agents",
      "decentralized networks",
      "user privacy",
      "data interoperability"
    ],
    "skills": [
      "computer engineering",
      "software development",
      "technology innovation",
      "leadership",
      "data privacy"
    ]
  }
} as any;

describe('Hyde Generator Tests', () => {
  let agent: HydeGeneratorAgent;

  beforeAll(() => {
    agent = new HydeGeneratorAgent(new IndexEmbedder());
  });

  test('Generate HyDE Description', async () => {
    const profileContext = `
        Bio: ${mockProfile.identity.bio}
        Location: ${mockProfile.identity.location}
        Interests: ${mockProfile.attributes.interests.join(', ')}
        Skills: ${mockProfile.attributes.skills.join(', ')}

        `;

    try {
      const result = await agent.generate(profileContext);
      const description = result.description;

      expect(description).toBeDefined();
      expect(description.length).toBeGreaterThan(50);
    } catch (error) {
      throw error;
    }
  }, 60000); // Increased timeout to 60s
});
