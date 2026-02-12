-- Drop index_id column from opportunities; index scope is stored in context JSONB
DROP INDEX IF EXISTS "opportunities_index_idx";--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT IF EXISTS "opportunities_index_id_indexes_id_fk";--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN IF EXISTS "index_id";
