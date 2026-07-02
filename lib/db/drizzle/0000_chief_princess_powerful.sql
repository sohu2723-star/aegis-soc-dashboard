CREATE TABLE `security_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` varchar(64) NOT NULL,
	`subtype` varchar(128) NOT NULL,
	`severity` varchar(16) NOT NULL,
	`source_ip` varchar(45) NOT NULL,
	`target_host` varchar(255) NOT NULL,
	`tool_used` varchar(64),
	`description` text NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'detected',
	`layer` varchar(32) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `security_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`severity` varchar(16) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'open',
	`description` text NOT NULL,
	`responder` varchar(128),
	`notes` text,
	`event_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`message` text NOT NULL,
	`severity` varchar(16) NOT NULL,
	`channel` varchar(32) NOT NULL DEFAULT 'dashboard',
	`acknowledged` boolean NOT NULL DEFAULT false,
	`event_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_status` (
	`id` int AUTO_INCREMENT NOT NULL,
	`component` varchar(64) NOT NULL,
	`layer` varchar(32) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'unknown',
	`description` text NOT NULL,
	`metrics` text,
	`last_check` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `system_status_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`type` varchar(32) NOT NULL,
	`format` varchar(16) NOT NULL DEFAULT 'html',
	`summary` text NOT NULL,
	`events_count` int NOT NULL DEFAULT 0,
	`incidents_count` int NOT NULL DEFAULT 0,
	`generated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `network_hosts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ip` varchar(45) NOT NULL,
	`hostname` varchar(128) NOT NULL,
	`role` varchar(32) NOT NULL DEFAULT 'unknown',
	`os` varchar(64),
	`mac` varchar(17),
	`open_ports` text,
	`status` varchar(16) NOT NULL DEFAULT 'online',
	`is_monitored` boolean NOT NULL DEFAULT false,
	`last_seen` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `network_hosts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `blocked_ips` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ip` varchar(45) NOT NULL,
	`reason` text NOT NULL,
	`blocked_by` varchar(32) NOT NULL DEFAULT 'manual',
	`is_active` boolean NOT NULL DEFAULT true,
	`blocked_at` timestamp NOT NULL DEFAULT (now()),
	`unblocked_at` timestamp,
	CONSTRAINT `blocked_ips_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `defense_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` varchar(32) NOT NULL,
	`action` varchar(64) NOT NULL,
	`target_ip` varchar(45) NOT NULL,
	`reason` text NOT NULL,
	`performed_by` varchar(64) NOT NULL DEFAULT 'system',
	`status` varchar(32) NOT NULL DEFAULT 'success',
	`related_event_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `defense_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `firewall_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chain` varchar(16) NOT NULL DEFAULT 'INPUT',
	`action` varchar(16) NOT NULL,
	`protocol` varchar(8),
	`source_ip` varchar(45),
	`dest_ip` varchar(45),
	`source_port` varchar(16),
	`dest_port` varchar(16),
	`iface` varchar(16),
	`rule_text` text NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`applied_at` timestamp NOT NULL DEFAULT (now()),
	`created_by` varchar(64) NOT NULL DEFAULT 'admin',
	CONSTRAINT `firewall_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `encrypted_traffic` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_ip` varchar(45) NOT NULL,
	`dest_ip` varchar(45) NOT NULL,
	`dest_port` int,
	`tls_version` varchar(16),
	`cipher_suite` varchar(128),
	`sni` varchar(255),
	`cert_issuer` varchar(255),
	`cert_subject` varchar(255),
	`cert_expiry` varchar(32),
	`is_suspicious` boolean NOT NULL DEFAULT false,
	`reason` varchar(128),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `encrypted_traffic_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ftp_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_ip` varchar(45) NOT NULL,
	`username` varchar(64),
	`command` varchar(16),
	`file_path` varchar(512),
	`file_size` int,
	`status` varchar(16) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ftp_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `http_attacks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_ip` varchar(45) NOT NULL,
	`target_url` varchar(1024) NOT NULL,
	`method` varchar(8) NOT NULL,
	`status_code` int,
	`attack_type` varchar(64),
	`payload` text,
	`user_agent` varchar(512),
	`rule_id` varchar(16),
	`blocked` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `http_attacks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ssh_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_ip` varchar(45) NOT NULL,
	`username` varchar(64),
	`status` varchar(16) NOT NULL,
	`auth_method` varchar(16),
	`session_id` varchar(64),
	`failures` int NOT NULL DEFAULT 0,
	`banned_by` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`ended_at` timestamp,
	CONSTRAINT `ssh_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `attack_counters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_ip` varchar(45) NOT NULL,
	`attack_type` varchar(64) NOT NULL,
	`count` int NOT NULL DEFAULT 1,
	`window_start` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `attack_counters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `defense_commands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rule_id` int,
	`event_id` int,
	`target_vm` varchar(32) NOT NULL DEFAULT 'ubuntu',
	`command_type` varchar(32) NOT NULL,
	`command_text` text NOT NULL,
	`undo_command` text,
	`target_ip` varchar(45),
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`error_msg` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`executed_at` timestamp,
	CONSTRAINT `defense_commands_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `defense_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`trigger_attack_type` varchar(64) NOT NULL DEFAULT 'any',
	`trigger_severity` varchar(16) NOT NULL DEFAULT 'any',
	`trigger_threshold` int NOT NULL DEFAULT 1,
	`trigger_window_secs` int NOT NULL DEFAULT 60,
	`action_type` varchar(16) NOT NULL DEFAULT 'auto',
	`defense_type` varchar(32) NOT NULL,
	`action_params` text,
	`target_vm` varchar(32) NOT NULL DEFAULT 'ubuntu',
	`priority` int NOT NULL DEFAULT 100,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `defense_rules_id` PRIMARY KEY(`id`)
);
