-- Remove manage:negotiations from chat orchestrator permissions.
-- Negotiations are now exclusively handled by the Index Negotiator agent.
UPDATE agent_permissions
SET actions = array_remove(actions, 'manage:negotiations')
WHERE agent_id = '00000000-0000-0000-0000-000000000001'
  AND 'manage:negotiations' = ANY(actions);
