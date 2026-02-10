-- Drop unused tables from project cleanup (agents, intent_stakes, intent_stake_items, elaboration_requests)
DROP TABLE IF EXISTS "intent_stake_items";
--> statement-breakpoint
DROP TABLE IF EXISTS "intent_stakes";
--> statement-breakpoint
DROP TABLE IF EXISTS "elaboration_requests";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."elaboration_request_status";
--> statement-breakpoint
DROP TABLE IF EXISTS "agents";
