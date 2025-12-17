import { UserMemoryProfile, ActiveIntent } from "./intent.manager.types";
import { IntentDetectorResponse } from "../inferrer/explicit.inferrer.types";
import { ExplicitIntentDetector } from "../inferrer/explicit.inferrer";

const explicitDetector = new ExplicitIntentDetector();
/**
 * Orchestrates the intent detection process.
 * 
 * It takes new user content, user context (profile and active intents),
 * and delegates logic to specific detectors (like ExplicitIntentDetector).
 * 
 * @param content - The new text content from the user (e.g. a message or command).
 * @param profile - The user's long-term memory profile.
 * @param activeIntents - The list of currently active intents.
 * @returns A promise resolving to the detected actions (create, update, expire) or generic response.
 */
export async function processIntent(
    content: string,
    profile: UserMemoryProfile,
    activeIntents: ActiveIntent[]
): Promise<IntentDetectorResponse> {
    // 1. Run Explicit Detector
    // In the future, this might also run Implicit detectors or other heuristics.
    const response = await explicitDetector.run(content, profile, activeIntents);

    return response;
}
