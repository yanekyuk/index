import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, needsClarification, UUID_REGEX } from "./tool.helpers";
import { protocolLogger } from "../support/protocol.logger";

const logger = protocolLogger("ChatTools:Profile");

export function createProfileTools(defineTool: DefineTool, deps: ToolDeps) {
  const { userDb, systemDb, graphs } = deps;

  const readUserProfiles = defineTool({
    name: "read_user_profiles",
    description:
      "Fetches user profiles. In an index-scoped chat, no args returns the current user's profile. With `userId`: returns that user's profile. With `indexId`: returns profiles of all members in that index. Outside an index-scoped chat, `userId` or `indexId` is required.",
    querySchema: z.object({
      userId: z.string().optional().describe("Optional user ID to fetch a specific user's profile"),
      indexId: z.string().optional().describe("Optional index ID to fetch profiles of all members in that index"),
    }),
    handler: async ({ context, query }) => {
      const effectiveIndexId = query.indexId?.trim() || undefined;
      const targetUserId = query.userId?.trim() || undefined;

      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }

      // Guard: when chat is NOT index-scoped and no userId/indexId provided, disallow
      if (!effectiveIndexId && !targetUserId && !context.indexId) {
        return error("Please provide a userId or indexId. Outside of an index-scoped chat, read_user_profiles requires at least one of these parameters. To read your own profile, pass your own userId.");
      }

      // --- Mode 3: indexId provided → fetch all member profiles ---
      if (effectiveIndexId) {
        // Strict scope enforcement: when chat is index-scoped, only allow querying that index
        if (context.indexId && effectiveIndexId !== context.indexId) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this index'}. You can only read profiles from this community.`
          );
        }

        // Verify the caller is a member of the index they're querying
        const callerIsMember = await systemDb.isIndexMember(effectiveIndexId, context.userId);
        if (!callerIsMember) {
          return error(
            "You can only read profiles from indexes you are a member of."
          );
        }

        // Use systemDb for cross-user access within shared indexes
        const members = await systemDb.getIndexMembers(effectiveIndexId);
        const profiles = await Promise.all(
          members.map(async (member) => {
            const profile = await systemDb.getProfile(member.userId);
            return {
              userId: member.userId,
              name: member.name,
              hasProfile: !!profile,
              profile: profile
                ? {
                    name: profile.identity.name,
                    bio: profile.identity.bio,
                    location: profile.identity.location,
                    skills: profile.attributes.skills,
                    interests: profile.attributes.interests,
                  }
                : undefined,
            };
          })
        );
        return success({ indexId: effectiveIndexId, memberCount: members.length, profiles });
      }

      // --- Mode 2: userId provided (different user) → fetch single profile directly ---
      if (targetUserId && targetUserId !== context.userId) {
        // Strict scope enforcement: when chat is index-scoped, verify user is in that index
        if (context.indexId) {
          const isInScopedIndex = await systemDb.isIndexMember(context.indexId, targetUserId);
          if (!isInScopedIndex) {
            return error(
              `This chat is scoped to ${context.indexName ?? 'this index'}. You can only read profiles of members in this community.`
            );
          }
        }

        // Use systemDb for cross-user profile access (requires shared index)
        const profile = await systemDb.getProfile(targetUserId);
        if (profile) {
          return success({
            hasProfile: true,
            profile: {
              name: profile.identity.name,
              bio: profile.identity.bio,
              location: profile.identity.location,
              skills: profile.attributes.skills,
              interests: profile.attributes.interests,
            },
          });
        }
        return success({ hasProfile: false, message: "This user does not have a profile yet." });
      }

      // --- Mode 1: No args / self → use profileGraph query (returns id for updates) ---
      const result = await graphs.profile.invoke({
        userId: context.userId,
        operationMode: 'query' as const,
      });

      if (result.readResult) {
        return success(result.readResult);
      }
      if (result.profile) {
        return success({
          hasProfile: true,
          profile: {
            name: result.profile.identity.name,
            bio: result.profile.identity.bio,
            location: result.profile.identity.location,
            skills: result.profile.attributes.skills,
            interests: result.profile.attributes.interests,
          },
        });
      }
      return success({
        hasProfile: false,
        message: "You don't have a profile yet. Would you like to create one? You can share your LinkedIn, GitHub, or X/Twitter profile, or just tell me about yourself.",
      });
    },
  });

  const createUserProfile = defineTool({
    name: "create_user_profile",
    description:
      "Auto-generates (or regenerates) a profile from the user's account data (name, email, social links) via web search. Works whether or not the user already has a profile. Call with no args first; if it returns missing fields, ask the user conversationally for their full name and/or social URLs, then call again with those fields filled in.",
    querySchema: z.object({
      name: z.string().optional().describe("User's full name (first and last), if provided by the user"),
      linkedinUrl: z.string().optional().describe("LinkedIn profile URL"),
      githubUrl: z.string().optional().describe("GitHub profile URL"),
      twitterUrl: z.string().optional().describe("X/Twitter profile URL"),
      websites: z.array(z.string()).optional().describe("Personal or portfolio website URLs"),
      location: z.string().optional().describe("User's location (city, country)"),
    }),
    handler: async ({ context, query }) => {
      // If any user-info fields are provided, persist them to the users table first
      const hasSocials = !!(query.linkedinUrl || query.githubUrl || query.twitterUrl || (query.websites && query.websites.length));
      if (query.name || query.location || hasSocials) {
        const socialsUpdate: { linkedin?: string; github?: string; x?: string; websites?: string[] } = {};
        if (query.linkedinUrl) socialsUpdate.linkedin = query.linkedinUrl;
        if (query.githubUrl) socialsUpdate.github = query.githubUrl;
        if (query.twitterUrl) socialsUpdate.x = query.twitterUrl;
        if (query.websites && query.websites.length) socialsUpdate.websites = query.websites;

        // Use userDb for the user's own data
        await userDb.updateUser({
          ...(query.name ? { name: query.name } : {}),
          ...(query.location ? { location: query.location } : {}),
          ...(hasSocials ? { socials: socialsUpdate } : {}),
        });
        logger.info("Updated user record before profile generation", { userId: context.userId });
      }

      // Invoke profile graph in generate mode (uses user table data + Parallels searchUser)
      const result = await graphs.profile.invoke({
        userId: context.userId,
        operationMode: 'generate' as const,
        forceUpdate: true,
      });

      // If user info is insufficient, ask conversationally
      if (result.needsUserInfo) {
        return needsClarification({
          missingFields: result.missingUserInfo || ['social_urls', 'full_name'],
          message: "I need a bit more information to create your profile. Could you share your full name and any social links (LinkedIn, GitHub, or X/Twitter)?",
        });
      }

      if (result.error) {
        return error(result.error);
      }

      if (result.profile) {
        return success({
          created: true,
          message: "Profile generated from your account data.",
          profile: {
            name: result.profile.identity.name,
            bio: result.profile.identity.bio,
            location: result.profile.identity.location,
            skills: result.profile.attributes.skills,
            interests: result.profile.attributes.interests,
          },
        });
      }

      return error("Failed to create profile. Please try again.");
    },
  });

  const updateUserProfile = defineTool({
    name: "update_user_profile",
    description:
      "Updates the user's existing profile. Requires profileId from read_user_profiles. Use ONE call per request with all changes in action (and details if needed). For profile URLs call scrape_url first, then pass scraped content in details.",
    querySchema: z.object({
      profileId: z.string().describe("The profile id from read_user_profiles"),
      action: z.string().describe("What to do: one or more changes, e.g. 'update bio to X', 'add Python to skills'"),
      details: z.string().optional().describe("Additional context or pasted content"),
    }),
    handler: async ({ context, query }) => {
      // Use profileGraph query mode to validate profile existence
      const queryResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
      if (!queryResult.readResult?.hasProfile && !queryResult.profile) {
        return error("You don't have a profile yet. Use create_user_profile first.");
      }
      const existingProfileId = queryResult.readResult?.profile?.id;
      if (existingProfileId && existingProfileId !== query.profileId.trim()) {
        return error("Invalid profileId. Use the profile id from read_user_profiles.");
      }

      const inputForProfile = [query.action, query.details].filter(Boolean).join("\n") || (query.details ?? query.action);
      if (!inputForProfile.trim()) {
        return error("Please specify what to update (e.g. action: 'update bio to X').");
      }

      // Execute update directly
      await graphs.profile.invoke({
        userId: context.userId,
        operationMode: "write",
        input: inputForProfile,
        forceUpdate: true,
      });
      return success({ message: "Profile updated." });
    },
  });

  return [readUserProfiles, createUserProfile, updateUserProfile] as const;
}
