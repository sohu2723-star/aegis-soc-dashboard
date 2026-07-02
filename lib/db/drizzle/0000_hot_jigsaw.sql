CREATE TABLE "security_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "security_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" varchar(64) NOT NULL,
	"subtype" varchar(128) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"source_ip" varchar(45) NOT NULL,
	"target_host" varchar(255) NOT NULL,
	"tool_used" varchar(64),
	"description" text NOT NULL,
	"status" varchar(32) DEFAULT 'detected' NOT NULL,
	"layer" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "incidents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(255) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"description" text NOT NULL,
	"responder" varchar(128),
	"notes" text,
	"event_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alerts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message" text NOT NULL,
	"severity" varchar(16) NOT NULL,
	"channel" varchar(32) DEFAULT 'dashboard' NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"event_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_status" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "system_status_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"component" varchar(64) NOT NULL,
	"layer" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'unknown' NOT NULL,
	"description" text NOT NULL,
	"metrics" text,
	"last_check" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(255) NOT NULL,
	"type" varchar(32) NOT NULL,
	"format" varchar(16) DEFAULT 'html' NOT NULL,
	"summary" text NOT NULL,
	"events_count" integer DEFAULT 0 NOT NULL,
	"incidents_count" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_hosts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "network_hosts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ip" varchar(45) NOT NULL,
	"hostname" varchar(128) NOT NULL,
	"role" varchar(32) DEFAULT 'unknown' NOT NULL,
	"os" varchar(64),
	"mac" varchar(17),
	"open_ports" text,
	"status" varchar(16) DEFAULT 'online' NOT NULL,
	"is_monitored" boolean DEFAULT false NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocked_ips" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "blocked_ips_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ip" varchar(45) NOT NULL,
	"reason" text NOT NULL,
	"blocked_by" varchar(32) DEFAULT 'manual' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"blocked_at" timestamp DEFAULT now() NOT NULL,
	"unblocked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "defense_actions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "defense_actions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" varchar(32) NOT NULL,
	"action" varchar(64) NOT NULL,
	"target_ip" varchar(45) NOT NULL,
	"reason" text NOT NULL,
	"performed_by" varchar(64) DEFAULT 'system' NOT NULL,
	"status" varchar(32) DEFAULT 'success' NOT NULL,
	"related_event_id" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firewall_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "firewall_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chain" varchar(16) DEFAULT 'INPUT' NOT NULL,
	"action" varchar(16) NOT NULL,
	"protocol" varchar(8),
	"source_ip" varchar(45),
	"dest_ip" varchar(45),
	"source_port" varchar(16),
	"dest_port" varchar(16),
	"iface" varchar(16),
	"rule_text" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"applied_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'admin' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encrypted_traffic" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "encrypted_traffic_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_ip" varchar(45) NOT NULL,
	"dest_ip" varchar(45) NOT NULL,
	"dest_port" integer,
	"tls_version" varchar(16),
	"cipher_suite" varchar(128),
	"sni" varchar(255),
	"cert_issuer" varchar(255),
	"cert_subject" varchar(255),
	"cert_expiry" varchar(32),
	"is_suspicious" boolean DEFAULT false NOT NULL,
	"reason" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ftp_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ftp_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_ip" varchar(45) NOT NULL,
	"username" varchar(64),
	"command" varchar(16),
	"file_path" varchar(512),
	"file_size" integer,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "http_attacks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "http_attacks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_ip" varchar(45) NOT NULL,
	"target_url" varchar(1024) NOT NULL,
	"method" varchar(8) NOT NULL,
	"status_code" integer,
	"attack_type" varchar(64),
	"payload" text,
	"user_agent" varchar(512),
	"rule_id" varchar(16),
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ssh_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_ip" varchar(45) NOT NULL,
	"username" varchar(64),
	"status" varchar(16) NOT NULL,
	"auth_method" varchar(16),
	"session_id" varchar(64),
	"failures" integer DEFAULT 0 NOT NULL,
	"banned_by" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "attack_counters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "attack_counters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_ip" varchar(45) NOT NULL,
	"attack_type" varchar(64) NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"window_start" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defense_commands" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "defense_commands_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"rule_id" integer,
	"event_id" integer,
	"target_vm" varchar(32) DEFAULT 'ubuntu' NOT NULL,
	"command_type" varchar(32) NOT NULL,
	"command_text" text NOT NULL,
	"undo_command" text,
	"target_ip" varchar(45),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"error_msg" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"executed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "defense_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "defense_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(128) NOT NULL,
	"description" text,
	"trigger_attack_type" varchar(64) DEFAULT 'any' NOT NULL,
	"trigger_severity" varchar(16) DEFAULT 'any' NOT NULL,
	"trigger_threshold" integer DEFAULT 1 NOT NULL,
	"trigger_window_secs" integer DEFAULT 60 NOT NULL,
	"action_type" varchar(16) DEFAULT 'auto' NOT NULL,
	"defense_type" varchar(32) NOT NULL,
	"action_params" text,
	"target_vm" varchar(32) DEFAULT 'ubuntu' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
