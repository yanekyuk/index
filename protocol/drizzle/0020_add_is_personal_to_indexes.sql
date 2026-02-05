-- Add is_personal column to indexes (personal index = "Everything" in Frontend)
ALTER TABLE "indexes" ADD COLUMN IF NOT EXISTS "is_personal" boolean DEFAULT false NOT NULL;
