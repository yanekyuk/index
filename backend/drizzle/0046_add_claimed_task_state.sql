ALTER TYPE "public"."opportunity_status" ADD VALUE 'negotiating' BEFORE 'pending';--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "state" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "state" SET DEFAULT 'submitted'::text;--> statement-breakpoint
DROP TYPE "public"."task_state";--> statement-breakpoint
CREATE TYPE "public"."task_state" AS ENUM('submitted', 'working', 'input_required', 'completed', 'failed', 'canceled', 'rejected', 'auth_required', 'waiting_for_agent', 'claimed');--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "state" SET DEFAULT 'submitted'::"public"."task_state";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "state" SET DATA TYPE "public"."task_state" USING "state"::"public"."task_state";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "claimed_by_agent_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "claimed_at" timestamp with time zone;