-- Prevent duplicate owner permission rows for the same (agent, user) when scope = 'global'.
-- Closes a race in reconcileNegotiationsPermission (AgentService) where concurrent toggle
-- requests could both issue revoke-then-grant sequences and end up with two rows.
CREATE UNIQUE INDEX uniq_agent_permissions_global
  ON agent_permissions (agent_id, user_id)
  WHERE scope = 'global';
