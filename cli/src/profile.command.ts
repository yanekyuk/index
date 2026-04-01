/**
 * Profile command handlers for the Index CLI.
 *
 * Implements: (default), show, sync subcommands.
 * Follows the same handleX(client, subcommand, positionals, options)
 * pattern as network.command.ts and conversation.command.ts.
 */

import type { ApiClient } from "./api.client";
import * as output from "./output";

const PROFILE_HELP = `
Usage:
  index profile                      Show your profile
  index profile show <user-id>       Show another user's profile
  index profile sync                 Regenerate your profile
  index profile search <query>       Search user profiles
`;

/**
 * Route a profile subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param subcommand - The subcommand (show, sync, or undefined for self).
 * @param positionals - Positional arguments after the subcommand.
 */
export async function handleProfile(
  client: ApiClient,
  subcommand: string | undefined,
  positionals: string[],
  options: { json?: boolean } = {},
): Promise<void> {
  if (subcommand === "sync") {
    await profileSync(client);
    return;
  }

  if (subcommand === "show") {
    const userId = positionals[0];
    if (!userId) {
      output.error("Usage: index profile show <user-id>", 1);
      return;
    }
    await profileShow(client, userId);
    return;
  }

  if (subcommand === "search") {
    const query = positionals.join(" ");
    if (!query) { output.error("Usage: index profile search <query>", 1); return; }
    const result = await client.callTool("read_user_profiles", { query });
    if (options.json) { console.log(JSON.stringify(result)); return; }
    if (!result.success) { output.error(result.error ?? "Search failed", 1); return; }
    const data = result.data as { profiles: Array<{ userId: string; name: string; profile?: { bio: string } }> };
    output.heading("Search Results");
    if (!data.profiles?.length) {
      output.dim("  No profiles found.");
    } else {
      for (const p of data.profiles) {
        console.log(`  ${p.name} (${p.userId.slice(0, 8)})`);
        if (p.profile?.bio) output.dim(`    ${p.profile.bio.slice(0, 100)}`);
      }
    }
    console.log();
    return;
  }

  // Default: show own profile
  await profileMe(client);
}

/**
 * Show the authenticated user's own profile.
 */
async function profileMe(client: ApiClient): Promise<void> {
  output.info("Loading your profile...");
  const me = await client.getMe();
  const user = await client.getUser(me.id);
  output.profileCard(user);
}

/**
 * Show another user's profile by ID.
 */
async function profileShow(client: ApiClient, userId: string): Promise<void> {
  output.info("Loading profile...");
  const user = await client.getUser(userId);
  output.profileCard(user);
}

/**
 * Trigger profile regeneration for the authenticated user.
 */
async function profileSync(client: ApiClient): Promise<void> {
  output.info("Regenerating profile...");
  await client.syncProfile();
  output.success("Profile regeneration triggered. It may take a moment to complete.");
}
