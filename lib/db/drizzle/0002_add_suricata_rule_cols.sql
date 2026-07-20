ALTER TABLE "encrypted_traffic" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "encrypted_traffic" CASCADE;--> statement-breakpoint
ALTER TABLE "defense_commands" ALTER COLUMN "target_vm" SET DEFAULT 'all';--> statement-breakpoint
ALTER TABLE "defense_rules" ALTER COLUMN "target_vm" SET DEFAULT 'bank-web';--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "signature_id" integer;--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "alert_rev" integer;--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "alert_action" varchar(32);--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "alert_category" varchar(128);