-- Backfill: rename interpretation.summary → interpretation.reasoning in existing opportunities.
-- The TypeScript OpportunityInterpretation interface now uses "reasoning" instead of "summary".
-- This migration copies the value and removes the old key in a single JSONB update.
UPDATE opportunities
SET interpretation = (interpretation - 'summary') || jsonb_build_object('reasoning', interpretation->'summary')
WHERE interpretation ? 'summary'
  AND NOT (interpretation ? 'reasoning');
