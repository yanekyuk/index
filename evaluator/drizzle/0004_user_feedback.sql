CREATE TABLE IF NOT EXISTS "user_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "feedback" text NOT NULL,
  "session_id" text,
  "conversation" jsonb,
  "retry_conversation" jsonb,
  "retry_status" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "user_feedback_user_idx" ON "user_feedback" USING btree ("user_id");
