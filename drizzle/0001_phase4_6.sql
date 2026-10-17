CREATE TYPE "public"."channel_scope" AS ENUM('global', 'user');--> statement-breakpoint
CREATE TYPE "public"."compounding" AS ENUM('monthly', 'quarterly', 'half_yearly', 'yearly', 'simple');--> statement-breakpoint
CREATE TYPE "public"."fixed_kind" AS ENUM('fd', 'rd', 'bond', 'ppf', 'epf', 'nps', 'sgb', 'gold', 'reit', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."holding_kind" AS ENUM('equity', 'foreign_equity', 'debt', 'fund', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."loan_event_kind" AS ENUM('prepayment', 'rate_change');--> statement-breakpoint
CREATE TYPE "public"."loan_kind" AS ENUM('home', 'car', 'personal', 'education', 'gold', 'other');--> statement-breakpoint
CREATE TABLE "alert_sent" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"alert_type" text NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_subscription" (
	"channel_id" uuid NOT NULL,
	"alert_type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "alert_subscription_channel_id_alert_type_pk" PRIMARY KEY("channel_id","alert_type")
);
--> statement-breakpoint
CREATE TABLE "fixed_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "fixed_kind" NOT NULL,
	"name" text NOT NULL,
	"institution" text,
	"principal" numeric(18, 2) NOT NULL,
	"rate_pct" numeric(6, 3) DEFAULT '0' NOT NULL,
	"compounding" "compounding" DEFAULT 'quarterly' NOT NULL,
	"payout" boolean DEFAULT false NOT NULL,
	"start_date" date NOT NULL,
	"maturity_date" date,
	"balance" numeric(18, 2),
	"balance_as_of" date,
	"asset_class" text,
	"closed_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_holding" (
	"id" serial PRIMARY KEY NOT NULL,
	"fund_id" integer NOT NULL,
	"as_of_month" date NOT NULL,
	"holding_instrument_id" integer,
	"name" text NOT NULL,
	"isin" text,
	"kind" "holding_kind" NOT NULL,
	"sector" text,
	"weight_pct" numeric(9, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "loan_kind" NOT NULL,
	"name" text NOT NULL,
	"lender" text,
	"principal" numeric(18, 2) NOT NULL,
	"rate_pct" numeric(6, 3) NOT NULL,
	"tenure_months" integer NOT NULL,
	"emi" numeric(18, 2),
	"first_emi_date" date NOT NULL,
	"closed_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" "loan_event_kind" NOT NULL,
	"amount" numeric(18, 2),
	"rate_pct" numeric(6, 3),
	"reduce" text DEFAULT 'tenure' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "channel_scope" NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"webhook_enc" text NOT NULL,
	"webhook_hint" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "target_allocation" (
	"profile_id" uuid NOT NULL,
	"asset_class" text NOT NULL,
	"target_pct" numeric(5, 2) NOT NULL,
	"band_pct" numeric(5, 2),
	CONSTRAINT "target_allocation_profile_id_asset_class_pk" PRIMARY KEY("profile_id","asset_class")
);
--> statement-breakpoint
ALTER TABLE "alert_sent" ADD CONSTRAINT "alert_sent_channel_id_notification_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_subscription" ADD CONSTRAINT "alert_subscription_channel_id_notification_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_holding" ADD CONSTRAINT "fund_holding_fund_id_instrument_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."instrument"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_holding" ADD CONSTRAINT "fund_holding_holding_instrument_id_instrument_id_fk" FOREIGN KEY ("holding_instrument_id") REFERENCES "public"."instrument"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_allocation" ADD CONSTRAINT "target_allocation_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_sent_uq" ON "alert_sent" USING btree ("channel_id","alert_type","key");--> statement-breakpoint
CREATE INDEX "fund_holding_fund_idx" ON "fund_holding" USING btree ("fund_id","as_of_month");--> statement-breakpoint
CREATE INDEX "loan_event_loan_idx" ON "loan_event" USING btree ("loan_id","date");