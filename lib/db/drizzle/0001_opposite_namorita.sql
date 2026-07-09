CREATE TABLE "app_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_status" ADD COLUMN "host_ip" varchar(45);--> statement-breakpoint
ALTER TABLE "blocked_ips" ADD COLUMN "target_host" varchar(255);--> statement-breakpoint
ALTER TABLE "defense_actions" ADD COLUMN "target_host" varchar(255);