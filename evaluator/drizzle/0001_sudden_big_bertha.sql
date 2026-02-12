DO $$ BEGIN
 CREATE TYPE "public"."eval_run_status" AS ENUM('draft', 'running', 'completed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."eval_scenario_status" AS ENUM('pending', 'running', 'completed', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text,
	"config" jsonb,
	"status" "eval_run_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_scenario_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eval_run_id" uuid NOT NULL,
	"scenario_id" text NOT NULL,
	"need_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"category" text NOT NULL,
	"tools" jsonb NOT NULL,
	"message" text NOT NULL,
	"status" "eval_scenario_status" DEFAULT 'pending' NOT NULL,
	"conversation" jsonb,
	"result" jsonb,
	"review_flag" text,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "eval_scenario_results" ADD CONSTRAINT "eval_scenario_results_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_runs_user_idx" ON "eval_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_scenario_results_run_idx" ON "eval_scenario_results" USING btree ("eval_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_scenario_results_scenario_idx" ON "eval_scenario_results" USING btree ("eval_run_id","scenario_id");