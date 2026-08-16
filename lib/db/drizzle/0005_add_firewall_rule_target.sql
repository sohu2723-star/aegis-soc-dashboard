ALTER TABLE "firewall_rules"
ADD COLUMN "target_vm" varchar(32) DEFAULT 'all' NOT NULL;
