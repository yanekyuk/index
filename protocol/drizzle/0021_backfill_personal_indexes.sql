-- Backfill personal indexes for existing users (one "Everything" index per user)
DO $$
DECLARE
  r RECORD;
  new_id UUID;
BEGIN
  FOR r IN
    SELECT u.id AS user_id
    FROM users u
    WHERE u.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM index_members im
        JOIN indexes i ON i.id = im.index_id AND i.is_personal = true
        WHERE im.user_id = u.id
      )
  LOOP
    new_id := gen_random_uuid();
    INSERT INTO indexes (id, title, is_personal, permissions, created_at, updated_at)
    VALUES (
      new_id,
      'Everything',
      true,
      '{"joinPolicy":"invite_only","invitationLink":null,"allowGuestVibeCheck":false}'::json,
      now(),
      now()
    );
    INSERT INTO index_members (index_id, user_id, permissions, created_at, updated_at)
    VALUES (new_id, r.user_id, ARRAY['owner'], now(), now());
  END LOOP;
END $$;
