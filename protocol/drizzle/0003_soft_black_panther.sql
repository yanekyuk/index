CREATE TABLE IF NOT EXISTS "intent_stake_items" (
	"stake_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intent_stake_items_stake_idx" ON "intent_stake_items" USING btree ("stake_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intent_stake_items_user_idx" ON "intent_stake_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddingIndex" ON "intents" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "initiator_receiver_created_idx" ON "user_connection_events" USING btree ("initiator_user_id","receiver_user_id","created_at");