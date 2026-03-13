CREATE TABLE "personal_indexes" (
	"user_id" text NOT NULL,
	"index_id" text NOT NULL,
	CONSTRAINT "personal_indexes_user_id_pk" PRIMARY KEY("user_id")
);
--> statement-breakpoint
ALTER TABLE "personal_indexes" ADD CONSTRAINT "personal_indexes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_indexes" ADD CONSTRAINT "personal_indexes_index_id_indexes_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."indexes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_indexes_index_id_unique" ON "personal_indexes" USING btree ("index_id");--> statement-breakpoint
INSERT INTO "personal_indexes" ("user_id", "index_id") SELECT "owner_id", "id" FROM "indexes" WHERE "is_personal" = true AND "owner_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "indexes" DROP CONSTRAINT "personal_owner_check";--> statement-breakpoint
ALTER TABLE "indexes" DROP CONSTRAINT "indexes_owner_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "indexes_is_personal_owner";--> statement-breakpoint
ALTER TABLE "indexes" DROP COLUMN "owner_id";