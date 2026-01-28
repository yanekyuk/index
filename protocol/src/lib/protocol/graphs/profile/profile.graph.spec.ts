/**
 * Tests for ProfileGraph
 */
import { config } from "dotenv";
config({ path: 'protocol/.env.development', override: true });

import { describe, expect, it, beforeAll, spyOn, mock } from "bun:test";
import { ProfileGraphFactory } from "./profile.graph";
import { Database } from "../../interfaces/database.interface"; // Mock
import { Embedder } from "../../interfaces/embedder.interface"; // Mock
import { Scraper } from "../../interfaces/scraper.interface"; // Mock
import { ProfileGraphState } from "./profile.graph.state";
import { ProfileGenerator } from "../../agents/profile/profile.generator";
import { HydeGenerator } from "../../agents/profile/hyde/hyde.generator";

// State persistence mock
let profileStateInDB: any = null;

// Mock Database
const mockDatabase = {
  exists: mock(async () => !!profileStateInDB),
  update: mock(async (table, args) => { profileStateInDB = { ...profileStateInDB, ...args.data }; }),
  create: mock(async (table, args) => { profileStateInDB = args.data; }),
  find: mock(async () => []),
  get: mock(async (table: string, query: any) => {
    if (table === 'users') {
      return {
        id: query.filter.id,
        name: "Seref Yarar",
        email: "seref@index.network",
        socials: {
          linkedin: "https://www.linkedin.com/in/serefyarar/",
          twitter: "https://x.com/hyperseref"
        }
      };
    }
    return profileStateInDB;
  })
} as unknown as Database;

const mockEmbedder = {
  generate: mock(async () => [[0.1, 0.2, 0.3]])
} as unknown as Embedder;

const mockScraper = {
  scrape: mock(async (objective: string) => "Scraped content from " + objective)
} as unknown as Scraper;

// spy on agents
spyOn(ProfileGenerator.prototype, 'invoke').mockReturnValue(Promise.resolve({
  output: {
    identity: { name: "Generated User", bio: "Bio", location: "Loc" },
    narrative: { context: "Context" },
    attributes: { interests: [], skills: [] },
  },
  textToEmbed: "Profile Text"
}));

spyOn(HydeGenerator.prototype, 'invoke').mockReturnValue(Promise.resolve({
  output: {
    identity: { bio: "HyDE Bio" },
    narrative: { context: "HyDE Context" },
    attributes: { interests: [], skills: [] }
  },
  textToEmbed: "HyDE Text"
}));


describe('ProfileGraph Conditional Flow', () => {
  let graphRunner: any;

  beforeAll(() => {
    const factory = new ProfileGraphFactory(mockDatabase, mockEmbedder, mockScraper);
    graphRunner = factory.createGraph();
  });

  it('Scenario 1: New User (Requires Scraping + Profile + HyDE)', async () => {
    profileStateInDB = null; // Reset DB
    (mockScraper.scrape as any).mockClear();
    (mockEmbedder.generate as any).mockClear();

    const inputState: typeof ProfileGraphState.State = {
      userId: "user-new",
      objective: undefined, // objective is intermediate, verify undefined input works
      input: undefined,
      profile: undefined,
      hydeDescription: undefined
    };

    const result = await graphRunner.invoke(inputState);

    expect(mockScraper.scrape).toHaveBeenCalled();
    const scrapeCallArg = (mockScraper.scrape as any).mock.calls[0][0];
    expect(scrapeCallArg).toContain("Seref Yarar");

    expect(result.input).toContain("Scraped");
    expect(result.profile).toBeDefined();
    expect(result.profile?.embedding).toEqual([[0.1, 0.2, 0.3]]);
    expect(result.hydeDescription).toBeDefined();

    // Verify DB state
    expect(profileStateInDB).toBeDefined();
    expect(profileStateInDB.userId).toBe("user-new");
    expect(profileStateInDB.hydeDescription).toBe("HyDE Text");
  });

  it('Scenario 2: Existing User (Missing Embedding + Missing HyDE)', async () => {
    // Setup DB with partial profile (valid structure)
    profileStateInDB = {
      userId: "user-partial",
      identity: { name: "Existing User", bio: "Bio", location: "Loc" },
      narrative: { context: "Context" },
      attributes: { interests: [], skills: [] }
    };
    (mockScraper.scrape as any).mockClear();
    (mockEmbedder.generate as any).mockClear();

    const inputState: typeof ProfileGraphState.State = {
      userId: "user-partial",
      objective: undefined,
      input: undefined,
      profile: undefined,
      hydeDescription: undefined
    };

    const result = await graphRunner.invoke(inputState);

    expect(mockScraper.scrape).not.toHaveBeenCalled(); // Should NOT scrape
    expect(mockEmbedder.generate).toHaveBeenCalledTimes(2); // Embed Profile + Embed HyDE

    // Result should have upgraded profile
    expect(result.profile?.embedding).toBeDefined();
    expect(result.hydeDescription).toBeDefined();
  });

  it('Scenario 3: Existing User (Complete)', async () => {
    // Setup DB with full profile
    profileStateInDB = {
      userId: "user-complete",
      identity: { name: "Complete User", bio: "Bio", location: "Loc" },
      narrative: { context: "Full Context" },
      attributes: { interests: [], skills: [] },
      embedding: [[0.9, 0.9]], // Existing embedding
      hydeDescription: "Existing HyDE",
      hydeEmbedding: [[0.8, 0.8]]
    };
    (mockScraper.scrape as any).mockClear();
    (mockEmbedder.generate as any).mockClear();

    const inputState: typeof ProfileGraphState.State = {
      userId: "user-complete",
      objective: undefined,
      input: undefined,
      profile: undefined,
      hydeDescription: undefined
    };

    const result = await graphRunner.invoke(inputState);

    expect(mockScraper.scrape).not.toHaveBeenCalled();
    expect(mockEmbedder.generate).not.toHaveBeenCalled(); // Should skip everything
  });
});
