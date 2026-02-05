/**
 * Intent Freshness Auditor Agent
 * 
 * Analyzes intents for expiration based on temporal markers and semantic analysis.
 * Archives intents that are no longer valid (expired job postings, past events, etc.)
 */

import db from '../../../lib/drizzle/drizzle';
import { intents, users } from '../../../schemas/database.schema';
import { isNull, eq } from 'drizzle-orm';
import { traceableStructuredLlm } from '../../../lib/agents';
import { z } from 'zod';
import { Events } from '../../../lib/events';
import { format } from 'timeago.js';

// OpenRouter preset: intent-freshness-auditor
// Configured to analyze temporal context and expiration signals

const CONFIDENCE_THRESHOLD = 70;

export interface FreshnessResult {
  isExpired: boolean;
  confidenceScore: number;
}

const SYSTEM_PROMPT = `You are an intent freshness analyzer. Determine if an intent has EXPIRED based on both explicit temporal markers AND the inherent nature of the intent type.

EXPLICIT EXPIRATION - An intent is EXPIRED if it contains:
1. Past dates or time periods (e.g., "Q1 2024" when current date is later)
2. Time-sensitive opportunities that have clearly passed (e.g., "attending conference next week" from 6 months ago)
3. Job postings with stale timelines (e.g., "hiring for Summer 2023 internship" when we're in 2025)
4. Event-specific intents tied to past dates (e.g., "speaking at DevConf March 15" when that date has passed)
5. Seasonal or time-bound offers that are clearly outdated

IMPLICIT EXPIRATION - Consider the nature and typical lifecycle of intent types:

SHORT-TERM INTENTS (typically expire after 1-3 months):
- Job searching / "looking for work" / "open to opportunities"
- Seeking specific roles or positions
- Attending upcoming events or conferences
- Buying/selling specific items or services
- Urgent help or immediate needs
- Short-term project collaborations

MEDIUM-TERM INTENTS (typically expire after 3-6 months):
- Looking for co-founders or team members
- Fundraising or seeking investment
- Beta testing or early access requests
- Specific project launches
- Learning specific skills for near-term goals
- Networking for specific opportunities

EVERGREEN INTENTS (rarely expire without explicit markers):
- General research interests or areas of expertise
- Professional background and capabilities
- Open to consulting or advisory roles (general)
- Industry interests and passions
- Building long-term projects or companies
- Core professional identity statements

INTRO COMPATIBILITY - If the user has an intro (bio), old intents that are incompatible with the intro should be expired:
- If the intro describes a different role, company, or focus than the intent, the intent is likely outdated
- If the intro indicates the user has moved on from what the intent describes, mark it expired
- If the intro contradicts the intent (e.g., intro says "currently building X" but intent says "looking to build Y"), expire the intent

EXPIRATION GUIDELINES:
- A "looking for work" intent from 4+ months ago is likely stale (either found work or gave up)
- A "seeking co-founder" intent from 6+ months ago is probably outdated
- An event attendance from 2+ weeks ago is definitely expired
- General interests and expertise are evergreen regardless of age
- Consider context: "building X" is ongoing, "looking to build X" may expire
- If user has an intro that contradicts or supersedes the intent, expire it

An intent is NOT EXPIRED if:
- It's evergreen in nature (expertise, interests, ongoing projects)
- It's recent enough for its type (job search under 2 months, etc.)
- Context suggests ongoing relevance
- It's a statement of capability rather than seeking
- It's compatible with the user's current intro

Confidence scoring:
- 90-100: Clear expired temporal markers OR obviously stale for its intent type OR incompatible with intro
- 75-89: Strong signals of expiration (time-sensitive intent that's aged out or intro incompatibility)
- 70-74: Probable expiration (intent type + age suggest staleness or minor intro conflicts)
- Below 70: Not confident enough to archive

Be thoughtful about intent types but err on the side of caution.`;

/**
 * Analyze a single intent for freshness
 * @deprecated
 */
export async function auditIntentFreshness(intentId: string): Promise<FreshnessResult> {
  try {
    // Fetch intent with user info
    const intentRows = await db.select({
      id: intents.id,
      payload: intents.payload,
      createdAt: intents.createdAt,
      userId: intents.userId
    })
      .from(intents)
      .where(eq(intents.id, intentId))
      .limit(1);

    if (intentRows.length === 0) {
      throw new Error(`Intent ${intentId} not found`);
    }

    const intent = intentRows[0];

    // Fetch user intro if available
    const userRows = await db.select({ intro: users.intro })
      .from(users)
      .where(eq(users.id, intent.userId))
      .limit(1);
    const userIntro = userRows[0]?.intro;

    const FreshnessSchema = z.object({
      isExpired: z.boolean().describe("Whether the intent has expired"),
      confidenceScore: z.number().min(0).max(100).describe("Confidence score 0-100")
    });

    // Use timeago.js for human-readable relative time
    const timeAgo = format(intent.createdAt);

    const userMessage = {
      role: "user",
      content: `Analyze this intent for expiration:

Intent: "${intent.payload}"
Created: ${timeAgo}${userIntro ? `\n\nUser Intro (Bio): "${userIntro}"` : ''}

Is this intent expired? ${userIntro ? 'Consider if the intent is incompatible with the user\'s current intro.' : ''} Provide confidence score.`
    };


    const freshnessCall = traceableStructuredLlm(
      "intent-freshness-auditor",
      {
        agent_type: "intent_freshness_auditor",
        operation: "freshness_check",
        intent_id: intentId
      }
    );

    const response = await freshnessCall(
      [{ role: "system", content: SYSTEM_PROMPT }, userMessage],
      FreshnessSchema
    );

    return {
      isExpired: response.isExpired,
      confidenceScore: response.confidenceScore
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Archive an intent by setting archivedAt timestamp
 */
async function archiveIntent(intentId: string, userId: string): Promise<void> {


  await db.update(intents)
    .set({
      archivedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(intents.id, intentId));


}

/**
 * Process a single intent with timeout
 */
async function processIntentWithTimeout(intent: { id: string; userId: string }, timeoutMs: number): Promise<{ archived: boolean }> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout after ${timeoutMs / 1000} seconds`)), timeoutMs);
  });

  const processPromise = (async () => {
    const result = await auditIntentFreshness(intent.id);


    if (result.isExpired && result.confidenceScore >= CONFIDENCE_THRESHOLD) {
      await archiveIntent(intent.id, intent.userId);
      return { archived: true };
    }


    return { archived: false };
  })();

  return Promise.race([processPromise, timeoutPromise]);
}

/**
 * Audit all non-archived intents and archive expired ones
 * Maintains 100 concurrent operations at any time
 * @deprecated
 */
export async function auditAllIntents(): Promise<{
  audited: number;
  archived: number;
  errors: number;
}> {
  const allIntents = await db.select({
    id: intents.id,
    userId: intents.userId,
    payload: intents.payload,
    summary: intents.summary
  })
    .from(intents)
    .where(isNull(intents.archivedAt));

  const CONCURRENT_LIMIT = 100;
  const TIMEOUT_MS = 40000;
  let totalAudited = 0;
  let totalArchived = 0;
  let totalErrors = 0;
  let intentIndex = 0;

  const activePromises = new Set<Promise<void>>();

  console.log(`Starting audit of ${allIntents.length} intents with concurrency limit ${CONCURRENT_LIMIT}...`);

  // Process intents concurrently, maintaining CONCURRENT_LIMIT active operations
  while (intentIndex < allIntents.length || activePromises.size > 0) {
    // Start new operations up to the limit
    while (activePromises.size < CONCURRENT_LIMIT && intentIndex < allIntents.length) {
      const intent = allIntents[intentIndex++];


      const promise = processIntentWithTimeout(intent, TIMEOUT_MS)
        .then((result) => {
          totalAudited++;
          if (result.archived) {
            totalArchived++;
          }
        })
        .catch((error) => {
          totalErrors++;
          console.error(`Error processing intent ${intent.id}:`, error.message);
        })
        .finally(() => {
          activePromises.delete(promise);
        });

      activePromises.add(promise);
    }

    // Wait for at least one operation to complete before starting more
    if (activePromises.size > 0) {
      await Promise.race(Array.from(activePromises));
    }

    // Log progress occasionally (every 100 processed)
    if (totalAudited % 100 === 0 && totalAudited > 0) {
      console.log(`Progress: audited=${totalAudited}, archived=${totalArchived}, errors=${totalErrors}`);
    }
  }

  console.log(`Final Summary: audited=${totalAudited}, archived=${totalArchived}, errors=${totalErrors}`);

  return { audited: totalAudited, archived: totalArchived, errors: totalErrors };
}

