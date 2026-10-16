CREATE TYPE "public"."access_level" AS ENUM('view', 'manage');--> statement-breakpoint
CREATE TYPE "public"."account_kind" AS ENUM('folio', 'demat');--> statement-breakpoint
CREATE TYPE "public"."cap_class" AS ENUM('large', 'mid', 'small');--> statement-breakpoint
CREATE TYPE "public"."instrument_type" AS ENUM('stock', 'mf', 'etf', 'index');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."txn_source" AS ENUM('manual', 'cas', 'demat_cas', 'tradebook', 'contract_note', 'sample');--> statement-breakpoint
CREATE TYPE "public"."txn_type" AS ENUM('buy', 'sell', 'sip', 'switch_in', 'switch_out', 'dividend_payout', 'dividend_reinvest', 'bonus', 'split');--> statement-breakpoint
CREATE TYPE "public"."underlying_class" AS ENUM('equity', 'debt', 'liquid', 'hybrid', 'gold', 'silver', 'international', 'other');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "account_kind" NOT NULL,
	"provider" text NOT NULL,
	"ref" text NOT NULL,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'member' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flag" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" "txn_source" NOT NULL,
	"filename" text,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instrument" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "instrument_type" NOT NULL,
	"name" text NOT NULL,
	"isin" text,
	"nse_symbol" text,
	"bse_code" text,
	"amfi_code" text,
	"yahoo_symbol" text,
	"dhan_security_id" text,
	"amc" text,
	"scheme_category" text,
	"plan" text,
	"sector" text,
	"cap_class" "cap_class",
	"is_fof" boolean DEFAULT false NOT NULL,
	"underlying_class" "underlying_class",
	"tracked_index" text,
	"benchmark_yahoo" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_price" numeric(20, 6),
	"last_price_date" date,
	"last_nav" numeric(20, 6),
	"last_nav_date" date,
	"history_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"instrument_id" integer NOT NULL,
	"date" date NOT NULL,
	"close" numeric(20, 6) NOT NULL,
	"adj_close" numeric(20, 6),
	CONSTRAINT "price_history_instrument_id_date_pk" PRIMARY KEY("instrument_id","date")
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"pan_hash" text,
	"pan_last4" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_access" (
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"level" "access_level" DEFAULT 'manage' NOT NULL,
	CONSTRAINT "profile_access_user_id_profile_id_pk" PRIMARY KEY("user_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sip_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"account_id" uuid,
	"instrument_id" integer NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"day_of_month" integer NOT NULL,
	"step_up_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "txn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"account_id" uuid,
	"instrument_id" integer NOT NULL,
	"date" date NOT NULL,
	"type" "txn_type" NOT NULL,
	"units" numeric(20, 6) NOT NULL,
	"price" numeric(20, 6) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"fees" numeric(18, 2) DEFAULT '0' NOT NULL,
	"source" "txn_source" NOT NULL,
	"dedup_key" text NOT NULL,
	"import_batch_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_feature" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_feature_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_access" ADD CONSTRAINT "profile_access_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_access" ADD CONSTRAINT "profile_access_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sip_plan" ADD CONSTRAINT "sip_plan_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sip_plan" ADD CONSTRAINT "sip_plan_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sip_plan" ADD CONSTRAINT "sip_plan_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "txn" ADD CONSTRAINT "txn_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "txn" ADD CONSTRAINT "txn_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "txn" ADD CONSTRAINT "txn_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "txn" ADD CONSTRAINT "txn_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feature" ADD CONSTRAINT "user_feature_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feature" ADD CONSTRAINT "user_feature_key_feature_flag_key_fk" FOREIGN KEY ("key") REFERENCES "public"."feature_flag"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_uq" ON "account" USING btree ("profile_id","kind","ref");--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_amfi_uq" ON "instrument" USING btree ("amfi_code");--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_nse_uq" ON "instrument" USING btree ("type","nse_symbol");--> statement-breakpoint
CREATE INDEX "instrument_isin_idx" ON "instrument" USING btree ("isin");--> statement-breakpoint
CREATE UNIQUE INDEX "txn_dedup_uq" ON "txn" USING btree ("profile_id","dedup_key");--> statement-breakpoint
CREATE INDEX "txn_profile_instr_idx" ON "txn" USING btree ("profile_id","instrument_id","date");