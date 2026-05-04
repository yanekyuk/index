CREATE TABLE IF NOT EXISTS "user_socials" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "value" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_user_socials_user_id" ON "user_socials" ("user_id");

-- Migrate existing JSON socials to rows
INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT id, 'linkedin', socials->>'linkedin'
FROM "users"
WHERE socials->>'linkedin' IS NOT NULL AND socials->>'linkedin' != '';

INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT id, 'twitter', socials->>'x'
FROM "users"
WHERE socials->>'x' IS NOT NULL AND socials->>'x' != '';

INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT id, 'github', socials->>'github'
FROM "users"
WHERE socials->>'github' IS NOT NULL AND socials->>'github' != '';

INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT id, 'telegram', socials->>'telegram'
FROM "users"
WHERE socials->>'telegram' IS NOT NULL AND socials->>'telegram' != '';

INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT u.id, 'custom', w.value
FROM "users" u,
     jsonb_array_elements_text(u.socials::jsonb->'websites') AS w(value)
WHERE u.socials IS NOT NULL
  AND u.socials::jsonb->'websites' IS NOT NULL
  AND jsonb_array_length(u.socials::jsonb->'websites') > 0;

-- Drop the old column
ALTER TABLE "users" DROP COLUMN IF EXISTS "socials";
