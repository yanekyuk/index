CREATE TYPE "public"."elaboration_request_status" AS ENUM('OPEN', 'RESOLVED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "public"."intent_mode" AS ENUM('REFERENTIAL', 'ATTRIBUTIVE');--> statement-breakpoint
CREATE TYPE "public"."intent_status" AS ENUM('ACTIVE', 'PAUSED', 'FULFILLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."speech_act_type" AS ENUM('COMMISSIVE', 'DIRECTIVE');--> statement-breakpoint
CREATE TABLE "elaboration_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"original_utterance" text NOT NULL,
	"missing_dimensions" text[],
	"system_prompt" text NOT NULL,
	"status" "elaboration_request_status" DEFAULT 'OPEN',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_source_intent_id_intents_id_fk";
--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "status" SET DEFAULT 'PENDING'::text;--> statement-breakpoint
DROP TYPE "public"."opportunity_status";--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED');--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"public"."opportunity_status";--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "status" SET DATA TYPE "public"."opportunity_status" USING "status"::"public"."opportunity_status";--> statement-breakpoint
DROP INDEX "opportunities_user_idx";--> statement-breakpoint
DROP INDEX "opportunities_candidate_idx";--> statement-breakpoint
DROP INDEX "opportunities_status_idx";--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "status" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "semantic_entropy" double precision DEFAULT 1;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "referential_anchor" text;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "intent_mode" "intent_mode" DEFAULT 'ATTRIBUTIVE';--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "speech_act_type" "speech_act_type";--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "felicity_authority" integer;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "felicity_sincerity" integer;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "status" "intent_status" DEFAULT 'ACTIVE';--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "source_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "valency_role" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "implicit_intents" json;--> statement-breakpoint
ALTER TABLE "elaboration_requests" ADD CONSTRAINT "elaboration_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_source_id_users_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_profiles_hyde_embedding_idx" ON "user_profiles" USING hnsw ("hyde_embedding" vector_cosine_ops);--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "reasoning";--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "source_intent_id";--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "expires_at";--> statement-breakpoint
DROP TYPE "public"."opportunity_type";