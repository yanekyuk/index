-- Fix personal index intent boundary (IND-159)
-- 1. Set autoAssign = true for owner memberships of personal indexes
-- 2. Remove contact intents from personal indexes (keep owner intents)

UPDATE index_members
SET auto_assign = true
WHERE permissions @> ARRAY['owner']
AND index_id IN (SELECT id FROM indexes WHERE is_personal = true);

DELETE FROM intent_indexes
WHERE index_id IN (SELECT id FROM indexes WHERE is_personal = true)
AND intent_id IN (
  SELECT i.id FROM intents i
  JOIN indexes idx ON idx.is_personal = true AND idx.id = intent_indexes.index_id
  WHERE i.user_id != idx.owner_id
);
