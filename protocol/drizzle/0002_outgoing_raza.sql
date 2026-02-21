DELETE FROM index_members
WHERE ctid NOT IN (
  SELECT min(ctid)
  FROM index_members
  GROUP BY index_id, user_id
);--> statement-breakpoint
ALTER TABLE "index_members" ADD CONSTRAINT "index_members_index_id_user_id_pk" PRIMARY KEY("index_id","user_id");
