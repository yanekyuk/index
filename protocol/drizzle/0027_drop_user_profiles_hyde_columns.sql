-- Consolidate HyDE storage into hyde_documents: drop profile HyDE from user_profiles
DROP INDEX IF EXISTS "user_profiles_hyde_embedding_idx";--> statement-breakpoint
ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "hyde_description";--> statement-breakpoint
ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "hyde_embedding";
