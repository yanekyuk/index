-- Opportunity redesign: drop old opportunities table and enum, then create new schema + hyde_documents
DROP TABLE IF EXISTS "opportunities";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."opportunity_status";--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."opportunity_status" AS ENUM('pending', 'viewed', 'accepted', 'rejected', 'expired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "detection" jsonb NOT NULL,
  "actors" jsonb NOT NULL,
  "interpretation" jsonb NOT NULL,
  "context" jsonb NOT NULL,
  "index_id" uuid NOT NULL,
  "confidence" numeric NOT NULL,
  "status" "public"."opportunity_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_index_id_indexes_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."indexes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_index_idx" ON "opportunities" USING btree ("index_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_status_idx" ON "opportunities" USING btree ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hyde_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid,
  "source_text" text,
  "strategy" text NOT NULL,
  "target_corpus" text NOT NULL,
  "context" jsonb,
  "hyde_text" text NOT NULL,
  "hyde_embedding" vector(2000) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hyde_source_strategy_unique" ON "hyde_documents" USING btree ("source_type", "source_id", "strategy", "target_corpus");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hyde_source_idx" ON "hyde_documents" USING btree ("source_type", "source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hyde_strategy_idx" ON "hyde_documents" USING btree ("strategy");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hyde_embedding_idx" ON "hyde_documents" USING hnsw ("hyde_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hyde_expires_idx" ON "hyde_documents" USING btree ("expires_at");
