CREATE TABLE IF NOT EXISTS "user_socials" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "value" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_socials_user_id" ON "user_socials" ("user_id");--> statement-breakpoint
INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT id, 'linkedin', socials->>'linkedin'
FROM "users"
WHERE socials->>'linkedin' IS NOT NULL AND socials->>'linkedin' != '';--> statement-breakpoint
INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT id, 'twitter', socials->>'x'
FROM "users"
WHERE socials->>'x' IS NOT NULL AND socials->>'x' != '';--> statement-breakpoint
INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT id, 'github', socials->>'github'
FROM "users"
WHERE socials->>'github' IS NOT NULL AND socials->>'github' != '';--> statement-breakpoint
INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT id, 'telegram', socials->>'telegram'
FROM "users"
WHERE socials->>'telegram' IS NOT NULL AND socials->>'telegram' != '';--> statement-breakpoint
INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT u.id, 'custom', btrim(w.value)
FROM "users" u
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(u.socials::jsonb->'websites') = 'array' THEN u.socials::jsonb->'websites'
    ELSE '[]'::jsonb
  END
) AS w(value)
WHERE u.socials IS NOT NULL
  AND btrim(w.value) <> '';--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "socials";
