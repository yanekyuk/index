-- Add optional index_id to chat_sessions for index-scoped chat (Phase 3)
ALTER TABLE "chat_sessions" ADD COLUMN "index_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_index_id_indexes_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."indexes"("id") ON DELETE SET NULL ON UPDATE no action;
