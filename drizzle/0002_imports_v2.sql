ALTER TYPE "public"."txn_source" ADD VALUE 'spreadsheet';--> statement-breakpoint
ALTER TYPE "public"."txn_source" ADD VALUE 'fixed_assets';--> statement-breakpoint
ALTER TYPE "public"."txn_source" ADD VALUE 'loans';--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "loan" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "loan_event" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;