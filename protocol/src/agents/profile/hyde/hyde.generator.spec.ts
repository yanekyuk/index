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
    "context": "Seref Yarar, based in Brooklyn, New York, operates in a dynamic and evolving tech landscape. He holds a strong academic background in Computer Engineering from Bahcesehir University. Initially making his mark as a Software Engineer and subsequently a Head of Engineering, Seref moved on to co-found GoWit Technology, where he held the role of CTO, developing advanced retail media advertisement platforms. Now, as the Co-Founder of Index Network, he leverages his engineering expertise to innovate within decentralized networks, focusing on custom search engines and data privacy protocols. His work involves collaboration with decentralized protocols and platforms such as Lit Protocol and Ceramic Network, aiming to empower users by giving them control over their data and interactions with digital content.",
    "aspirations": "Seref aspires to revolutionize how digital content is accessed and utilized. He is keenly interested in the integration of autonomous agents in everyday digital tasks to transform search engines and matchmaking services. Seeking to connect with like-minded professionals and developers, Seref aims to expand Index Network's influence to become a leader in decentralized and user-oriented data management solutions, ultimately creating technology that aligns with user privacy and personalization."
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
}

async function runTests() {
  console.log("🧪 Starting Hyde Generator Tests...\n");

  const agent = new HydeGeneratorAgent(new IndexEmbedder());

  console.log("1️⃣  Test: Generate HyDE Description");
  try {
    const result = await agent.generate(mockProfile);
    const description = result.description;
    console.log("Generated Description:\n", description);

    if (description && description.length > 50) {
      console.log("✅ Passed (Description generated and has sufficient length)");
    } else {
      console.error("❌ Failed (Description empty or too short)");
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Failed with error:", error);
    process.exit(1);
  }
}

// Check if running directly
if (require.main === module) {
  runTests().catch(console.error);
}

// Export for test runners if needed
export { runTests };
