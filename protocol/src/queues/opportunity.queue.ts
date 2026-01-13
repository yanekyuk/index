import { HydeGeneratorAgent } from '../agents/profile/hyde/hyde.generator';
import { OpportunityEvaluator } from '../agents/opportunity/opportunity.evaluator';
import { CandidateProfile, Opportunity } from '../agents/opportunity/opportunity.evaluator.types';
import { UserMemoryProfile } from '../agents/intent/manager/intent.manager.types';
import { ProfileService, profileService } from '../services/profile.service';
import { userProfiles } from '../lib/schema';
import { log } from '../lib/log';
import { ImplicitInferrer } from '../agents/intent/inferrer/implicit/implicit.inferrer';
import { intentService } from '../services/intent.service';
import { getUserAccessibleIndexIds } from '../lib/index-access';
import { stakeService } from '../services/stake.service';
import fs from 'fs/promises';
import path from 'path';
import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { IndexEmbedder } from '../lib/embedder';
import { json2md } from '../lib/json2md/json2md';
import { IntentManager } from '../agents/intent/manager/intent.manager';

export const QUEUE_NAME = 'opportunity-processing-queue';

export interface OpportunityJobData {
  timestamp: number;
  force: boolean;
}

/**
 * Opportunity Finder Queue.
 * 
 * RESPONSIBILITIES:
 * 1. `process_opportunities`: Runs the "Super Connector" cycle.
 * 
 * PERIODICITY:
 * - Runs every hour (or manually triggered).
 * - Finds users with "Opportunities" (e.g. "I'm looking for a co-founder") and finds
 *   best candidates across the entire userbase.
 */
export const opportunityQueue = QueueFactory.createQueue<OpportunityJobData>(QUEUE_NAME);

// Processor Helpers
function constructProfileText(profile: typeof userProfiles.$inferSelect): string {
  const parts = [
    profile.identity?.bio,
    profile.identity?.location,
    profile.narrative?.aspirations,
    profile.narrative?.context,
    ...(profile.attributes?.interests || []),
    ...(profile.attributes?.skills || [])
  ];
  return parts.filter(Boolean).join(' ');
}

// Processor Function
async function opportunityProcessor(job: Job) {
  if (job.name === 'process_opportunities') {
    await runOpportunityFinderCycle();
  } else {
    log.warn(`[OpportunityProcessor] Unknown job name: ${job.name}`);
  }
}

/**
 * Job: `process_opportunities`
 * 
 * CORE ALGORITHM (The "Opportunity Finder" Cycle):
 * 
 * 1. Backfill Embeddings: Ensures all active profiles have vector embeddings (for source & candidate matching).
 * 2. Iterate Sources: For every profile (as Source):
 *    - Backfill HyDE: If missing, generate "Ideal Candidate Description" (HyDE) vector.
 *    - Agent Discovery: Run `OpportunityEvaluator.runDiscovery()`:
 *      - Generates/Uses search query (HyDE or Profile).
 *      - Searches DB via injected `ProfileService.searchProfiles`.
 *      - Evaluates candidates.
 * 3. Implicit Intent Creation:
 *    - If Agent finds a Match Score > 85:
 *    - We assume the Source user *implicitly* has an intent to meet this person.
 *    - We assume the Candidate *implicitly* has an intent to meet the Source.
 *    - We create "Implicit Intents" (`type: 'enrichment'`) for both.
 *    - We create a Stake connecting them.
 */
export async function runOpportunityFinderCycle(
  _profileService: ProfileService = profileService,
  evaluator?: OpportunityEvaluator
) {
  // Setup Embedder injecting ProfileService search
  const embedder = new IndexEmbedder({
    searcher: _profileService.searchProfiles.bind(_profileService)
  });

  if (!evaluator) {
    evaluator = new OpportunityEvaluator(embedder);
  }

  const intentManager = new IntentManager(); // Instantiate Manager

  console.time('OpportunityFinderCycle');
  log.info('🔄 [OpportunityJob] Starting Opportunity Finder Cycle...');

  try {
    // 1. Backfill Missing Embeddings
    log.info('🔍 [OpportunityJob] Checking for missing embeddings...');
    const profilesWithoutEmbeddings = await _profileService.getProfilesMissingEmbeddings();

    log.info(`[OpportunityJob] Found ${profilesWithoutEmbeddings.length} profiles needing embeddings.`);

    for (const profile of profilesWithoutEmbeddings) {
      try {
        const textToEmbed = constructProfileText(profile);
        if (!textToEmbed || textToEmbed.length < 10) {
          log.warn(`[OpportunityJob] Skipping profile ${profile.userId} - Insufficient content.`);
          continue;
        }

        log.info(`[OpportunityJob] Generating embedding for user ${profile.userId}...`);
        log.debug(`[OpportunityJob] Payload length: ${textToEmbed.length} chars. Preview: "${textToEmbed.substring(0, 100)}..."`);
        const embedding = await embedder.generate(textToEmbed) as number[];

        await _profileService.updateProfileEmbedding(profile.id, embedding);

        log.info(`[OpportunityJob] ✅ Embedding updated for ${profile.userId}`);
      } catch (err) {
        log.error(`[OpportunityJob] ❌ Failed to generate embedding for ${profile.userId}:`, { error: err });
      }
    }

    // 2. Run Opportunity Finder for All Users
    log.info('🚀 [OpportunityJob] Running Opportunity Matchmaking...');
    const allCycleResults: any[] = [];

    // Fetch all valid profiles to act as sources
    const allProfiles = await _profileService.getAllProfilesWithEmbeddings();

    for (const sourceProfile of allProfiles) {
      log.info(`\n🔎 [OpportunityJob] Finding opportunities for ${sourceProfile.userId}...`);

      // Construct UserMemoryProfile object expected by Agent
      const memoryProfile: UserMemoryProfile = {
        userId: sourceProfile.userId,
        identity: sourceProfile.identity || {},
        narrative: sourceProfile.narrative || {},
        attributes: sourceProfile.attributes || {}
      } as any;

      if (!sourceProfile.embedding) {
        log.warn(`[OpportunityJob] Skipping ${sourceProfile.userId} - Missing embedding.`);
        continue;
      }

      // --- BACKFILL HyDE IF MISSING ---
      if (!sourceProfile.hydeEmbedding) {
        log.info(`   [OpportunityJob] Generating missing HyDE for ${sourceProfile.userId}...`);
        try {
          // Pass embedder to agent
          const hydeGenerator = new HydeGeneratorAgent(embedder);

          const profileContext = json2md.keyValue({
            bio: memoryProfile.identity.bio,
            location: memoryProfile.identity.location,
            interests: memoryProfile.attributes.interests,
            skills: memoryProfile.attributes.skills,
            aspirations: memoryProfile.narrative?.aspirations || '',
            context: memoryProfile.narrative?.context || ''
          });

          const result = await hydeGenerator.generate(profileContext);

          if (result && result.description) {
            const description = result.description;
            // Use returned embedding if available, otherwise generate it
            const embedding = (result.embedding || await embedder.generate(description)) as number[];

            // Update DB
            await _profileService.updateProfileHyde(sourceProfile.id, description, embedding);

            // Update local object so we can use it immediately
            sourceProfile.hydeDescription = description;
            sourceProfile.hydeEmbedding = embedding;
            log.info(`   [OpportunityJob] ✅ HyDE Generated & Backfilled.`);
          }
        } catch (e) {
          log.error(`   [OpportunityJob] ❌ Failed to generate HyDE for ${sourceProfile.userId}`, { error: e });
        }
      }
      // --------------------------------

      const hydeDesc = sourceProfile.hydeDescription;
      if (!hydeDesc) {
        log.warn(`[OpportunityJob] Skipping ${sourceProfile.userId} - Missing HyDE description (Backfill failed).`);
        continue;
      }

      // RUN AGENT DISCOVERY
      const profileContext = json2md.keyValue({
        bio: memoryProfile.identity.bio,
        location: memoryProfile.identity.location,
        interests: memoryProfile.attributes.interests,
        skills: memoryProfile.attributes.skills,
        aspirations: memoryProfile.narrative?.aspirations || '',
        context: memoryProfile.narrative?.context || ''
      });


      // --- DEDUPLICATION: Fetch Existing Stakes ---
      const existingStakes = await stakeService.getUserStakes(sourceProfile.userId, 20);
      let existingOpportunitiesContext = "";

      if (existingStakes.length > 0) {
        existingOpportunitiesContext = existingStakes
          .map(s => `- Match with ${s.candidateName} (ID: ${s.candidateId}) (Score: ${s.score}): ${s.reason}`)
          .join('\n');
      }

      const opportunities = await evaluator.runDiscovery(profileContext, {
        hydeDescription: hydeDesc,
        limit: 20, // Check top 20 nearest neighbors
        minScore: 0.5, // Filter low quality matches early (if searcher supports it)
        filter: {
          userId: { ne: sourceProfile.userId } // Exclude self
        } as any, // Use as any to bypass Option type limitation for filter specifics
        existingOpportunities: existingOpportunitiesContext
      });

      if (opportunities.length > 0) {
        log.info(`✨ [OpportunityJob] Found ${opportunities.length} opportunities for ${sourceProfile.userId}:`);
        opportunities.forEach(op => {
          log.info(`   - [${op.score}] ${op.title} (with ${op.candidateId})`);
        });

        allCycleResults.push({
          sourceUserId: sourceProfile.userId,
          sourceName: sourceProfile.identity?.name,
          opportunityCount: opportunities.length,
          opportunities: opportunities
        });

        // --- NEW: Implicit Intent & Stake Creation ---
        // For each high value opportunity, infer implicit intents and create a stake
        for (const op of opportunities) {
          if (op.score < 85) continue; // Only for very strong matches

          // We need to fetch the candidate profile again 
          const candidateProfile = await _profileService.getProfile(op.candidateId);
          if (!candidateProfile) continue;

          try {
            // 1. Process Source Intent
            log.info(`   [OpportunityJob] Processing implicit source intent for ${sourceProfile.userId}...`);

            // Fetch Active Intents for Source
            const sourceActiveIntents = await intentService.getUserIntentObjects(sourceProfile.userId);
            const sourceActiveContext = sourceActiveIntents
              .map(i => `ID: ${i.id}, Description: ${i.payload}, Status: active`)
              .join('\n');

            const sourceProfileContext = json2md.keyValue({
              bio: memoryProfile.identity.bio,
              location: memoryProfile.identity.location,
              interests: memoryProfile.attributes.interests,
              skills: memoryProfile.attributes.skills,
              aspirations: memoryProfile.narrative?.aspirations || '',
              context: memoryProfile.narrative?.context || ''
            });

            const sourceResponse = await intentManager.processImplicitIntent(
              sourceProfileContext,
              `Opportunity: ${op.title}. Reason: ${op.description}`,
              sourceActiveContext
            );

            const sourceIntentId = await resolveIntentFromActions(sourceProfile.userId, sourceResponse.actions);

            if (!sourceIntentId) {
              log.info(`   [OpportunityJob] Source intent not created/resolved. Skipping stake.`);
              continue;
            }

            // 2. Process Candidate Intent
            log.info(`   [OpportunityJob] Processing implicit candidate intent for ${candidateProfile.userId}...`);

            const candidateMemoryProfile: UserMemoryProfile = {
              userId: candidateProfile.userId,
              identity: candidateProfile.identity || {},
              narrative: candidateProfile.narrative || {},
              attributes: candidateProfile.attributes || {}
            } as any;

            // Fetch Active Intents for Candidate
            const candidateActiveIntents = await intentService.getUserIntentObjects(candidateProfile.userId);
            const candidateActiveContext = candidateActiveIntents
              .map(i => `ID: ${i.id}, Description: ${i.payload}, Status: active`)
              .join('\n');

            const candidateProfileContext = json2md.keyValue({
              bio: candidateMemoryProfile.identity.bio,
              location: candidateMemoryProfile.identity.location,
              interests: candidateMemoryProfile.attributes.interests,
              skills: candidateMemoryProfile.attributes.skills,
              aspirations: candidateMemoryProfile.narrative?.aspirations || '',
              context: candidateMemoryProfile.narrative?.context || ''
            });

            const candidateResponse = await intentManager.processImplicitIntent(
              candidateProfileContext,
              `Opportunity: ${op.title}. Reason: ${op.description}`,
              candidateActiveContext
            );

            const candidateIntentId = await resolveIntentFromActions(candidateProfile.userId, candidateResponse.actions);

            if (sourceIntentId && candidateIntentId) {
              log.info(`   [OpportunityJob] Creating implicit stake between ${sourceProfile.userId} and ${candidateProfile.userId}`);

              // 4. Create Stake
              await stakeService.saveMatch(
                sourceIntentId,
                candidateIntentId,
                op.score,
                op.description,
                '028ef80e-9b1c-434b-9296-bb6130509482' // OpportunityFinder Agent ID
              );
            }

          } catch (err) {
            log.error(`   [OpportunityJob] Failed to process implicit stake for ${sourceProfile.userId}`, { error: err });
          }
        }
        // ---------------------------------------------

      } else {
        log.info(`   [OpportunityJob] No high-value opportunities found.`);
      }
    }

    // Write full debug results
    if (allCycleResults.length > 0) {
      // Use a persistent path in root or tmp
      const debugPath = path.resolve(process.cwd(), 'opportunity-finder-results.json');
      await fs.writeFile(debugPath, JSON.stringify(allCycleResults, null, 2));
      log.info(`\n📝 [OpportunityJob] Debug results written to: ${debugPath}`);
    }

    log.info('✅ [OpportunityJob] Opportunity Finder Cycle Complete.');
    console.timeEnd('OpportunityFinderCycle');

  } catch (error) {
    log.error('❌ [OpportunityJob] Error in Opportunity Finder Cycle:', { error });
    console.timeEnd('OpportunityFinderCycle');
  }

}


export const opportunityWorker = QueueFactory.createWorker<OpportunityJobData>(QUEUE_NAME, opportunityProcessor);
export const queueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);

/**
 * Add a job to the Opportunity Queue.
 *
 * @param name - The name of the job ('process_opportunities').
 * @param data - The payload for the job.
 * @param priority - Optional priority level (higher number = higher priority).
 * @returns The created Job instance.
 */
export async function addJob(
  name: string,
  data: OpportunityJobData,
  priority: number = 0
): Promise<Job<OpportunityJobData>> {
  return opportunityQueue.add(name, data, {
    priority: priority > 0 ? priority : undefined,
  });
}

/**
 * Helper to execute IntentManager actions and return the effective Intent ID.
 */
async function resolveIntentFromActions(userId: string, actions: any[]): Promise<string | null> {
  // Priority: Create > Update > Ignore
  const createAction = actions.find(a => a.type === 'create');
  if (createAction) {
    const indexIds = await getUserAccessibleIndexIds(userId);
    const created = await intentService.createIntent({
      userId,
      payload: createAction.payload,
      indexIds,
      sourceType: 'enrichment', // Implicit
      confidence: 1.0, // Manager already verified
      inferenceType: 'implicit'
    });
    return created.id;
  }

  const updateAction = actions.find(a => a.type === 'update');
  if (updateAction) {
    // but if the manager says update, we update.
    await intentService.updateIntent(updateAction.id, userId, {
      payload: updateAction.payload
    });
    return updateAction.id;
  }

  // If only Expire or Ignore, we don't have a valid active intent for the stake
  return null;
}
