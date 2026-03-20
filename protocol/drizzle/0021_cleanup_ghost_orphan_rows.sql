-- Cleanup rows in tables that were missed by 0018_drop_ghost_users_and_user_contacts.
-- These tables have FK constraints to users but were not included in the original migration.
-- Safe to re-run: DELETEs are idempotent (ghost users were already deleted by 0018).

CREATE TEMP TABLE ghost_ids AS
SELECT id FROM "users" WHERE "is_ghost" = true;

DELETE FROM "personal_indexes" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "files" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "hidden_conversations" WHERE "user_id" IN (SELECT id FROM ghost_ids);

DROP TABLE IF EXISTS ghost_ids;
