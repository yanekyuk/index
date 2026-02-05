#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { Command } from 'commander';
import { eq, ne, isNull, sql, and } from 'drizzle-orm';
import db, { closeDb } from '../lib/drizzle/drizzle';
import { intents, intentStakes, intentStakeItems, users } from '../schemas/database.schema';
import { SEMANTIC_RELEVANCY_AGENT_ID } from '../lib/agent-ids';

const program = new Command();

program
  .name('create-stakes')
  .description('Create stakes between a user and all other users, and connect intents')
  .requiredOption('-u, --userId <userId>', 'User ID to create stakes for')
  .option('-s, --stake <stake>', 'Stake amount (default: 100)', '100')
  .option('--connect-others', 'Also connect intents between other users', false)
  .parse(process.argv);

const options = program.opts();

async function createStakesForUser(userId: string, stakeAmount: bigint, connectOthers: boolean) {
  try {
    // Verify user exists
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      console.error(`❌ User ${userId} not found`);
      process.exit(1);
    }

    console.log(`✅ Found user: ${user.name || user.email} (${userId})`);

    // Get all intents for this user
    const userIntents = await db.select().from(intents).where(
      and(eq(intents.userId, userId), isNull(intents.archivedAt))
    );

    if (userIntents.length === 0) {
      console.error(`❌ No intents found for user ${userId}`);
      process.exit(1);
    }

    console.log(`✅ Found ${userIntents.length} intents for user`);

    // Get all other users
    const otherUsers = await db.select().from(users).where(
      and(ne(users.id, userId), isNull(users.deletedAt))
    );

    console.log(`✅ Found ${otherUsers.length} other users`);

    // Get all intents for other users
    const otherUserIntents = await db.select().from(intents).where(
      and(
        sql`${intents.userId} IN (${sql.join(otherUsers.map(u => sql`${u.id}::uuid`), sql`, `)})`,
        isNull(intents.archivedAt)
      )
    );

    console.log(`✅ Found ${otherUserIntents.length} intents from other users`);

    let stakesCreated = 0;
    let stakesSkipped = 0;

    // Create stakes between user's intents and all other users' intents
    for (const userIntent of userIntents) {
      for (const otherIntent of otherUserIntents) {
        // Skip if same user (shouldn't happen, but safety check)
        if (userIntent.userId === otherIntent.userId) continue;

        const intentPair = [userIntent.id, otherIntent.id].sort();
        
        // Check if stake already exists
        const existingStake = await db.select()
          .from(intentStakes)
          .where(
            and(
              sql`${intentStakes.intents} = ARRAY[${sql.join(intentPair.map(id => sql`${id}::uuid`), sql`, `)}]::uuid[]`,
              eq(intentStakes.agentId, SEMANTIC_RELEVANCY_AGENT_ID)
            )
          )
          .limit(1);

        if (existingStake.length > 0) {
          stakesSkipped++;
          continue;
        }

        try {
          // Create stake
          const [newStake] = await db.insert(intentStakes).values({
            intents: intentPair,
            stake: stakeAmount,
            reasoning: `Connecting ${user.name || user.email} with other users`,
            agentId: SEMANTIC_RELEVANCY_AGENT_ID,
          }).returning({ id: intentStakes.id });

          // Insert into join table
          await db.insert(intentStakeItems).values([
            { stakeId: newStake.id, intentId: userIntent.id, userId: userIntent.userId },
            { stakeId: newStake.id, intentId: otherIntent.id, userId: otherIntent.userId }
          ]);

          stakesCreated++;
        } catch (error: any) {
          console.error(`Failed to create stake:`, error.message);
          stakesSkipped++;
        }
      }
    }

    console.log(`✅ Created ${stakesCreated} stakes, skipped ${stakesSkipped} existing`);

    // Optionally connect intents between other users
    let otherStakesCreated = 0;
    let otherStakesSkipped = 0;
    
    if (connectOthers) {
      console.log(`\n🔗 Connecting intents between other users...`);

      // Group intents by user
      const intentsByUser = new Map<string, typeof otherUserIntents>();
      for (const intent of otherUserIntents) {
        if (!intentsByUser.has(intent.userId)) {
          intentsByUser.set(intent.userId, []);
        }
        intentsByUser.get(intent.userId)!.push(intent);
      }

      // Create stakes between all pairs of users
      const userIds = Array.from(intentsByUser.keys());
      for (let i = 0; i < userIds.length; i++) {
        for (let j = i + 1; j < userIds.length; j++) {
          const userAIntents = intentsByUser.get(userIds[i])!;
          const userBIntents = intentsByUser.get(userIds[j])!;

          // Create stakes between all pairs of intents from these two users
          for (const intentA of userAIntents) {
            for (const intentB of userBIntents) {
              const intentPair = [intentA.id, intentB.id].sort();

              // Check if stake already exists
              const existingStake = await db.select()
                .from(intentStakes)
                .where(
                  and(
                    sql`${intentStakes.intents} = ARRAY[${sql.join(intentPair.map(id => sql`${id}::uuid`), sql`, `)}]::uuid[]`,
                    eq(intentStakes.agentId, SEMANTIC_RELEVANCY_AGENT_ID)
                  )
                )
                .limit(1);

              if (existingStake.length > 0) {
                otherStakesSkipped++;
                continue;
              }

              try {
                const [newStake] = await db.insert(intentStakes).values({
                  intents: intentPair,
                  stake: stakeAmount,
                  reasoning: `Connecting intents between users`,
                  agentId: SEMANTIC_RELEVANCY_AGENT_ID,
                }).returning({ id: intentStakes.id });

                await db.insert(intentStakeItems).values([
                  { stakeId: newStake.id, intentId: intentA.id, userId: intentA.userId },
                  { stakeId: newStake.id, intentId: intentB.id, userId: intentB.userId }
                ]);

                otherStakesCreated++;
              } catch (error: any) {
                console.error(`Failed to create stake:`, error.message);
                otherStakesSkipped++;
              }
            }
          }
        }
      }

      console.log(`✅ Created ${otherStakesCreated} stakes between other users, skipped ${otherStakesSkipped} existing`);
    }

    console.log(`\n✅ Done! Total stakes created: ${stakesCreated + (connectOthers ? otherStakesCreated : 0)}`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

createStakesForUser(options.userId, BigInt(options.stake), options.connectOthers);

