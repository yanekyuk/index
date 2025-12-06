-- Add denormalized intent_stake_items table with user_id for fast indexed lookups
-- This eliminates complex array operations when finding stakes between users

-- Step 1: Create the join table with user_id denormalized
CREATE TABLE IF NOT EXISTS "intent_stake_items" (
  "stake_id" uuid NOT NULL REFERENCES "intent_stakes"("id") ON DELETE CASCADE,
  "intent_id" uuid NOT NULL REFERENCES "intents"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  PRIMARY KEY ("stake_id", "intent_id")
);

-- Step 2: Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS "intent_stake_items_user_id_idx" ON "intent_stake_items" ("user_id");
CREATE INDEX IF NOT EXISTS "intent_stake_items_intent_id_idx" ON "intent_stake_items" ("intent_id");

-- Step 3: Backfill from existing data
-- Join intent_stakes.intents array with intents table to get user_id
INSERT INTO "intent_stake_items" ("stake_id", "intent_id", "user_id")
SELECT 
  s.id as stake_id,
  i.id as intent_id,
  i.user_id
FROM "intent_stakes" s
CROSS JOIN LATERAL UNNEST(s.intents) AS intent_id
JOIN "intents" i ON i.id = intent_id
ON CONFLICT DO NOTHING;

