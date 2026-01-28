import { StateGraph, START, END } from "@langchain/langgraph";
import { ProfileGraphState } from "./profile.graph.state";
import { ProfileGenerator, ProfileDocument } from "../../agents/profile/profile.generator";
import { HydeGenerator } from "../../agents/profile/hyde/hyde.generator";
import { Database } from "../../interfaces/database.interface";
import { Embedder } from "../../interfaces/embedder.interface";
import { Scraper } from "../../interfaces/scraper.interface";
import { log } from "../../../log";

/**
 * Factory class to build and compile the Profile Generation Graph.
 */
export class ProfileGraphFactory {
  constructor(
    private database: Database,
    private embedder: Embedder,
    private scraper: Scraper
  ) { }

  public createGraph() {
    const profileGenerator = new ProfileGenerator();
    const hydeGenerator = new HydeGenerator();

    // --- NODE DEFINITIONS ---

    /**
     * Node: Check DB State
     * Checks if profile exists and decides next steps.
     * Loads existing profile into state if found.
     */
    const checkStateNode = async (state: typeof ProfileGraphState.State) => {
      if (!state.userId) {
        throw new Error("userId is required");
      }

      const profile = await this.database.get<ProfileDocument>('user_profiles', { filter: { id: state.userId } });

      // If profile exists, load it into state
      return {
        profile: profile || undefined
      };
    };

    /**
     * Node: Scrape
     * Scrapes data from objective if input is not provided.
     */
    const scrapeNode = async (state: typeof ProfileGraphState.State) => {
      if (state.input) return {};

      // Fetch user details to construct objective
      log.info(`[Graph:Profile] Fetching user details for objective construction...`, { userId: state.userId });
      const user = await this.database.get<any>('users', { filter: { id: state.userId } });

      if (!user) {
        throw new Error(`User not found: ${state.userId}`);
      }

      const socialLinks = user.socials ? Object.values(user.socials).join('\n') : '';

      const objective = `
        Find information about the person named ${user.name || 'Unknown'}.
        ${user.email ? `This is their email address: ${user.email}` : ''}
        ${socialLinks ? `Here are some of their social profiles:\n${socialLinks}` : ''}
      `.trim();

      log.info(`[Graph:Profile] Constructed objective:`, { objective });
      const scrapedData = await this.scraper.scrape(objective);

      return {
        objective,
        input: scrapedData
      };
    };

    /**
     * Node: Generate Profile
     * Generates profile from input.
     */
    const generateProfileNode = async (state: typeof ProfileGraphState.State) => {
      // If we came from scrapeNode, input is merged into state. 
      // If we came directly (input provided), it's there.
      // LangGraph reducer logic handles merge.
      if (!state.input) throw new Error("Input required for profile generation");

      log.info("[Graph:Profile] Generating profile...");
      const result = await profileGenerator.invoke(state.input);

      return {
        profile: {
          ...result.output,
          userId: state.userId,
          embedding: [] as number[] | number[][]
        }
      };
    };

    /**
     * Node: Embed & Save Profile
     * Embeds the profile and upserts to DB.
     */
    const embedSaveProfileNode = async (state: typeof ProfileGraphState.State) => {
      if (!state.profile) throw new Error("Profile missing in embed step");

      const profile = { ...state.profile };
      const textToEmbed = [
        '# Identity',
        '## Name', profile.identity.name,
        '## Bio', profile.identity.bio,
        '## Location', profile.identity.location,
        '# Narrative',
        '## Context', profile.narrative.context,
        '# Attributes',
        '## Interests', profile.attributes.interests.join(', '),
        '## Skills', profile.attributes.skills.join(', ')
      ].join('\n');

      log.info("[Graph:Profile] Generating embedding...");
      const embedding = await this.embedder.generate(textToEmbed);
      profile.embedding = embedding;

      log.info("[Graph:Profile] Saving profile to DB...", { userId: state.userId });
      const exists = await this.database.exists('user_profiles', { filter: { id: state.userId } });

      if (exists) {
        await this.database.update('user_profiles', {
          filter: { userId: state.userId },
          data: { ...profile }
        });
      } else {
        await this.database.create('user_profiles', { data: { ...profile } });
      }

      return { profile };
    };


    /**
     * Node: Generate HyDE
     */
    const generateHydeNode = async (state: typeof ProfileGraphState.State) => {
      if (!state.profile) throw new Error("Profile missing for HyDE generation");

      log.info("[Graph:HyDE] Generating HyDE...");
      const profileString = JSON.stringify(state.profile, null, 2);
      const result = await hydeGenerator.invoke(profileString);

      return { hydeDescription: result.textToEmbed };
    };

    /**
     * Node: Embed & Save HyDE
     */
    const embedSaveHydeNode = async (state: typeof ProfileGraphState.State) => {
      if (!state.hydeDescription) throw new Error("HyDE description missing");

      log.info("[Graph:HyDE] Generating HyDE embedding...");
      const hydeEmbedding = await this.embedder.generate(state.hydeDescription);

      log.info("[Graph:HyDE] Saving HyDE to DB...", { userId: state.userId });

      const currentProfile = await this.database.get<any>('user_profiles', { filter: { id: state.userId } });
      if (currentProfile) {
        await this.database.update('user_profiles', {
          filter: { userId: state.userId },
          data: {
            ...currentProfile,
            hydeDescription: state.hydeDescription,
            hydeEmbedding
          }
        });
      } else {
        throw new Error("Profile not found during HyDE save");
      }

      return {};
    };

    // --- CONDITIONS ---

    const checkStateCondition = (state: typeof ProfileGraphState.State) => {
      if (!state.profile) {
        return "scrape"; // Need to generate profile
      }
      // Profile exists, check embedding
      if (!state.profile.embedding || state.profile.embedding.length === 0) {
        return "embed_save_profile";
      }

      // Profile and embedding good, check HyDE logic next. 
      // We can jump straight to check logic or just return key to generate_hyde IF needed.
      // Let's reuse checkHydeCondition logic here or duplicate slightly.
      const p = state.profile as any;
      if (!state.hydeDescription && (!p.hydeDescription || !p.hydeEmbedding)) {
        return "generate_hyde";
      }

      return END;
    };

    const checkHydeCondition = (state: typeof ProfileGraphState.State) => {
      const p = state.profile as any;
      if (!state.hydeDescription && (!p.hydeDescription || !p.hydeEmbedding)) {
        return "generate_hyde";
      }
      return END;
    };


    // --- GRAPH ASSEMBLY ---

    const workflow = new StateGraph(ProfileGraphState)
      .addNode("check_state", checkStateNode)
      .addNode("scrape", scrapeNode)
      .addNode("generate_profile", generateProfileNode)
      .addNode("embed_save_profile", embedSaveProfileNode)
      .addNode("generate_hyde", generateHydeNode)
      .addNode("embed_save_hyde", embedSaveHydeNode)

      .addEdge(START, "check_state")

      .addConditionalEdges(
        "check_state",
        checkStateCondition,
        {
          scrape: "scrape",
          embed_save_profile: "embed_save_profile",
          generate_hyde: "generate_hyde",
          [END]: END
        }
      )

      .addEdge("scrape", "generate_profile")
      .addEdge("generate_profile", "embed_save_profile")

      .addConditionalEdges(
        "embed_save_profile",
        checkHydeCondition,
        {
          generate_hyde: "generate_hyde",
          [END]: END
        }
      )

      .addEdge("generate_hyde", "embed_save_hyde")
      .addEdge("embed_save_hyde", END);

    return workflow.compile();
  }
}
