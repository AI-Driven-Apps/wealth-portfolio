CREATE TABLE "agent_report" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"scope_label" text,
	"status" text DEFAULT 'running' NOT NULL,
	"body" text,
	"error" text,
	"model" text,
	"usage" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_report" ADD CONSTRAINT "agent_report_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_report_user_idx" ON "agent_report" USING btree ("user_id","started_at");