CREATE TABLE "instrument_alias" (
	"source" text NOT NULL,
	"code" text NOT NULL,
	"isin" text,
	"instrument_id" integer,
	"name" text,
	"origin" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_alias_source_code_pk" PRIMARY KEY("source","code")
);
--> statement-breakpoint
ALTER TABLE "instrument_alias" ADD CONSTRAINT "instrument_alias_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE cascade ON UPDATE no action;