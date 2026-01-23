-- Delete duplicate index_members rows, keeping one per (index_id, user_id)
DELETE FROM index_members a
USING index_members b
WHERE a.ctid < b.ctid
  AND a.index_id = b.index_id
  AND a.user_id = b.user_id;

--> statement-breakpoint
-- Add primary key constraint to prevent future duplicates
ALTER TABLE index_members ADD PRIMARY KEY (index_id, user_id);
