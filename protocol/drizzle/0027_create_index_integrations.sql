CREATE TABLE "index_integrations" (
	"index_id" text NOT NULL,
	"toolkit" text NOT NULL,
	"connected_account_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "index_integrations_index_id_toolkit_pk" PRIMARY KEY("index_id","toolkit")
);
--> statement-breakpoint
ALTER TABLE "index_integrations" ADD CONSTRAINT "index_integrations_index_id_indexes_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."indexes"("id") ON DELETE no action ON UPDATE no action;