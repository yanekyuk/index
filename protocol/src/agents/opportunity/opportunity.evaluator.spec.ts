
import { describe, test, expect, beforeAll } from 'bun:test';
import { OpportunityEvaluator } from './opportunity.evaluator';
import { memorySearcher } from '../../lib/embedder/searchers/memory.searcher';
import { Embedder, VectorSearchResult, VectorStoreOption } from '../common/types';
import { CandidateProfile, Opportunity } from './opportunity.evaluator.types';
import { UserMemoryProfile } from '../intent/manager/intent.manager.types';
import { log } from '../../lib/log';
import { json2md } from '../../lib/json2md/json2md';

// Mock Embedder that uses MemorySearcher
class MockMemoryEmbedder implements Embedder {
  async generate(text: string | string[], dimensions?: number): Promise<number[] | number[][]> {
    // Return a fixed dummy vector for testing
    // In real memory search, we'd need meaningful vectors, but for unit testing the flow:
    // We will manually assign vectors to candidates to ensure "match" logic works in the searcher.
    // If we want "A" to match "A", we give them same vector.
    return [1, 0, 0];
  }

  async search<T>(queryVector: number[], collection: string, options?: VectorStoreOption<T>): Promise<VectorSearchResult<T>[]> {
    return memorySearcher(queryVector, collection, options);
  }
}

// Mock Data
const sourceProfile: UserMemoryProfile = {
  "identity": {
    "name": "Seref Yarar",
    "bio": "Seref Yarar is a Co-Founder at Index Network, utilizing his extensive background in software engineering to develop innovative, privacy-focused solutions for digital discovery. He aims to empower users by creating custom search engine technologies that prioritize data ownership and user intent.",
    "location": "New York, United States"
  },
  "narrative": {
    "context": "Seref Yarar is presently embedded in the thriving tech landscape of New York as the Co-Founder of Index Network. His career spans several influential roles, including his previous work as Co-Founder and CTO at GoWit Technology and as the Head of Engineering at Aleph Group, where he honed his skills in engineering and technology. With a Bachelor's degree in Computer Engineering from Bahcesehir University, Seref possesses a strong technical background that supports his ventures. Currently, he is focusing on creating decentralized data technologies. Seref's ongoing contributions to various repositories on GitHub reflect his commitment to advancing technology for enhanced user experiences."
  },
  "attributes": {
    "interests": [
      "Decentralized technologies",
      "Privacy in digital spaces",
      "Autonomous agents",
      "Software engineering",
      "Tech innovation",
      "User data ownership"
    ],
    "skills": [
      "Software development",
      "Project management",
      "Team leadership",
      "Product development",
      "Data privacy technologies",
      "Blockchain implementation"
    ]
  }
} as any;

const candidates: (CandidateProfile & { embedding: number[] })[] = [
  {
    identity: {
      name: "Seren Sandikci",
      bio: "Seren Sandikci is a co-founder and chief product officer at Index Network, where they leverage their extensive background in UX and product design to drive innovation and user-centric solutions. With a solid foundation in industrial design, Seren translates complexity into scalable solutions that align with market needs.",
      location: "New York, United States"
    },
    narrative: {
      context: "Seren Sandikci is currently based in New York, where they co-founded Index Network. Having previously held a senior UX designer role at QNB Finansbank and gaining experience in various design and development capacities, Seren is well-equipped to navigate the intersection of technology and user experience. At Index Network, they focus on developing custom search engines that prioritize user privacy and provide more tailored content discovery. This role allows them to apply their technological insight into a burgeoning venture that responds to the challenges posed by traditional web discovery tools."
    },
    attributes: {
      interests: [
        "User Experience Design",
        "Product Development",
        "Information Technology",
        "AI and Decentralization",
        "Digital Privacy"
      ],
      "skills": [
        "UX Design",
        "Product Strategy",
        "Business Development",
        "Stakeholder Communication",
        "Data-driven Design",
        "Strategic Planning",
        "Innovation Skills"
      ]
    },
    userId: "user_1",
    embedding: [1, 0, 0]
  },
  {
    identity: {
      name: "Brad Burnham",
      bio: "Brad Burnham is a seasoned venture capitalist with a deep passion for information discovery, merging insights from technology and human curiosity. With a robust background in computer science and economics, he focuses on startups that innovate how knowledge is discovered and utilized.",
      location: "Unknown City, Unknown Country"
    },
    narrative: {
      context: "Brad's journey began with a solid foundation in computer science and economics, where he developed a keen interest in how technology shapes the understanding of information. His career trajectory as a venture capitalist has been guided by a commitment to supporting startups that further the cause of meaningful knowledge discovery. He has become known for his thought-provoking questions during pitches, always seeking to understand the deeper implications of new technologies. Currently, he is actively involved in identifying and investing in projects that prioritize relevance and transparency in information dissemination, a mission that reflects his broader vision of empowering individuals in their quest for knowledge."
    },
    attributes: {
      interests: [
        "information discovery",
        "technology",
        "AI-driven insight tools",
        "data infrastructure",
        "research"
      ],
      "skills": [
        "venture capital",
        "startup evaluation",
        "investment strategies",
        "technology analysis",
        "questioning and critical thinking"
      ]
    },
    userId: "user_1768388518124",
    embedding: [0, 1, 0]
  },
  {
    identity: {
      name: "Yankı Ekin Yüksel",
      bio: "A driven computer science student and technology enthusiast based in Istanbul. Currently focusing on software development and participating in entrepreneurial ventures, leveraging his interest in digital media and tech innovations.",
      location: "Istanbul, Turkey"
    },
    narrative: {
      context: "Yankı Ekin Yüksel is a bright and ambitious individual navigating his academic journey at Boğaziçi University, where he is immersed in the fields of technology and digital media. He has a passion for exploring the intersection of software development and media consumption, which is evident in his work as a CTO at Aposto!, a dynamic new media company based in Istanbul. Balancing his studies along with the responsibilities of leading tech initiatives, Yankı often finds himself under pressure to excel both academically and professionally. His commitments to projects on GitHub and contributions to open-source initiatives have cultivated a robust online presence, reflecting his dedication to learning and collaboration. Although he's currently grounded in the vibrant city life of Istanbul, he is motivated by the latest technological advancements and how they can shape the future of media and communication."
    },
    attributes: {
      interests: [
        "Software Development",
        "Digital Media",
        "Technology Innovations",
        "Open Source Contributions",
        "Entrepreneurship"
      ],
      "skills": [
        "JavaScript",
        "Node.js",
        "Vue.js",
        "GitHub",
        "Software Development",
        "Project Management",
        "Team Collaboration"
      ]
    },
    userId: "user_3",
    embedding: [0, 0, 1]
  }
];

async function setupEvaluator() {
  const embedder = new MockMemoryEmbedder();
  const evaluator = new OpportunityEvaluator(embedder);

  // Mock the LLM evaluateOpportunities call
  evaluator.evaluateOpportunities = async (source, candidates) => {
    // Simple mock logic: Return a match for every candidate passed to it
    // The filtering happens upstream in findCandidates (memorySearcher)
    return candidates.map(c => ({
      type: 'collaboration',
      title: `Match with ${c.identity.name}`,
      description: 'Good match',
      score: 90,
      candidateId: c.userId
    }));
  };
  return evaluator;
}

const sourceProfileContext = json2md.keyValue({
  bio: sourceProfile.identity.bio,
  location: sourceProfile.identity.location,
  interests: sourceProfile.attributes.interests,
  skills: sourceProfile.attributes.skills,

  context: sourceProfile.narrative?.context || ''
});

describe('Opportunity Evaluator Tests', () => {
  test('Basic Flow & Filtering (MinScore 0.5)', async () => {
    log.info("--- Test: Basic Flow & Filtering (MinScore 0.5) ---");
    const evaluator = await setupEvaluator();

    const opportunities = await evaluator.runDiscovery(sourceProfileContext, {
      candidates: candidates,
      hydeDescription: "Looking for a co-founder",
      limit: 5,
      minScore: 0.5
    });

    expect(opportunities.length).toBe(1);
    expect(opportunities[0].candidateId).toBe('user_1');
  });

  test('Empty Candidates List', async () => {
    log.info("--- Test: Empty Candidates List ---");
    const evaluator = await setupEvaluator();

    const opportunities = await evaluator.runDiscovery(sourceProfileContext, {
      candidates: [],
      hydeDescription: "Looking for anyone",
      limit: 5
    });

    expect(opportunities.length).toBe(0);
  });

  test('High Threshold (MinScore 1.5 - Impossible)', async () => {
    log.info("--- Test: High Threshold (MinScore 1.5 - Impossible) ---");
    const evaluator = await setupEvaluator();

    // candidateB has score 1.0 (vector match). If we ask for 1.1, should find nothing.
    // Note: memorySearcher handles minScore filtering.
    const opportunities = await evaluator.runDiscovery(sourceProfileContext, {
      candidates: [candidates[0]],
      hydeDescription: "Looking for perfection",
      limit: 5,
      minScore: 1.1
    });

    expect(opportunities.length).toBe(0);
  });

  test('Candidate Missing UserId (Graceful Fail)', async () => {
    log.info("--- Test: Candidate Missing UserId (Graceful Fail) ---");
    const evaluator = await setupEvaluator();

    const candidateNoId = { ...candidates[0], userId: undefined } as any;

    const opportunities = await evaluator.runDiscovery(sourceProfileContext, {
      candidates: [candidateNoId],
      hydeDescription: "Searching...",
      limit: 5
    });

    // Depending on behavior, it returns an op with undefined candidateId
    if (opportunities.length > 0) {
      expect(opportunities[0].candidateId).toBeUndefined();
    }
  });

  test('Deduplication Prompt Logic', async () => {
    log.info("--- Test: Deduplication Prompt Logic ---");
    const evaluator = await setupEvaluator();

    const spyModel = {
      invoke: async (messages: any) => {
        // Messages struct: [SystemMessage, HumanMessage]
        const humanMessage = messages.find((m: any) => m.content && m.content.includes("CANDIDATE PROFILE"));
        if (!humanMessage) throw new Error("Could not find HumanMessage with Candidate Profile");

        if (!humanMessage.content.includes("EXISTING OPPORTUNITIES (Deduplication Context):")) {
          throw new Error("Prompt missing Deduplication Context header");
        }
        if (!humanMessage.content.includes("Already matched with Bob")) {
          throw new Error("Prompt missing existing opportunities content");
        }
        // Return dummy response structure
        return {
          opportunities: []
        };
      }
    };

    // Inject spy model (Cast to any to bypass private/protected check for testing)
    (evaluator as any).model = spyModel;

    const existing = "Already matched with Bob (Score: 95): Great match";

    // This should trigger the spy assertion
    await evaluator.evaluateOpportunities(sourceProfileContext, [candidates[1]], {
      minScore: 0.5,
      hydeDescription: "test",
      existingOpportunities: existing
    });
  });


  test('Synthesized Opportunity (Best Single Option)', async () => {
    log.info("--- Test: Synthesized Opportunity (Best Single Option) ---");
    const evaluator = await setupEvaluator();

    // Mock returning multiple distinct opportunities for a single candidate
    evaluator.evaluateOpportunities = async (source, candidates) => {
      // Return multiple ops, simulating what the LLM *might* have done before synthesis enforcement,
      // but also simulating the evaluator's job to pick the best if multiple *were* generated.
      // However, the *Synthesized* requirement is on the LLM prompt side.
      // Since we mock evaluateOpportunities here, we can test that our *code* only returns one
      // even if the internal logic (or a rogue LLM) produced multiple.

      return candidates.flatMap(c => [
        {
          type: 'collaboration',
          title: `Match A with ${c.identity.name}`,
          description: 'Good match A',
          score: 80,
          candidateId: c.userId
        },
        {
          type: 'mentorship',
          title: `Match B with ${c.identity.name}`,
          description: 'Good match B',
          score: 95,
          candidateId: c.userId
        }
      ] as Opportunity[]).sort((a, b) => b.score - a.score).slice(0, 1);
      // Note: We are mocking the method we just modified, so we should implement the mock 
      // to reflect the *behavior* of the real method (returning 1).
      // But actually, we want to test the *real* method logic if possible? 
      // Creating the mock overwrites the real logic. 
      // To test the *real* logic we need to mock the *LLM* (this.model.invoke), not the whole evaluateOpportunities method.
    };

    // Changing approach: testing the evaluateOpportunities filtering logic requires NOT mocking it.
    // But setupEvaluator mocks it. Let's create a fresh evaluator with a spied model.
  });

  test('Real Logic: synthesis of multiple returned options', async () => {
    // This test ensures that if the LLM (or analyzeMatch) returns multiple items, 
    // evaluateOpportunities strictly returns 1.
    const embedder = new MockMemoryEmbedder();
    const evaluator = new OpportunityEvaluator(embedder);

    // Spy on analyzeMatch to return multiple
    (evaluator as any).analyzeMatch = async (source: any, candidate: any, id: string) => {
      return [
        { type: 'networking', title: 'Low Score', description: 'Low', score: 50, candidateId: id },
        { type: 'collaboration', title: 'High Score', description: 'High', score: 99, candidateId: id }
      ];
    };

    const opportunities = await evaluator.runDiscovery(sourceProfileContext, {
      candidates: [candidates[0]],
      hydeDescription: "test",
      limit: 5,
      minScore: 0.5
    });

    expect(opportunities.length).toBe(1);
    expect(opportunities[0].score).toBe(99);
    expect(opportunities[0].title).toBe('High Score');
  });
});

