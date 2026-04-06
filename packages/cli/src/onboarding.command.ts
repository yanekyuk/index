/**
 * Onboarding command handlers for the Index CLI.
 *
 * Implements: complete subcommand.
 */

import type { ApiClient } from "./api.client";
import * as output from "./output";

const ONBOARDING_HELP = `
Onboarding Commands:
  index onboarding complete   Mark onboarding as complete
`;

/**
 * Route an onboarding subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param subcommand - The subcommand (complete).
 * @param options - Additional options (json).
 * @returns Resolves when the subcommand completes.
 */
export async function handleOnboarding(
  client: ApiClient,
  subcommand: string | undefined,
  options?: { json?: boolean },
): Promise<void> {
  if (subcommand === "complete") {
    await onboardingComplete(client, options?.json);
    return;
  }

  console.log(ONBOARDING_HELP);
}

/**
 * Mark the authenticated user's onboarding as complete.
 *
 * @param client - Authenticated API client.
 * @param json - Output raw JSON.
 */
async function onboardingComplete(client: ApiClient, json?: boolean): Promise<void> {
  if (!json) {
    output.info("Completing onboarding...");
  }
  const result = await client.callTool("complete_onboarding", {});
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  if (result.success) {
    output.success("Onboarding marked as complete.");
  } else {
    output.error(result.error ?? "Failed to complete onboarding.");
  }
}
