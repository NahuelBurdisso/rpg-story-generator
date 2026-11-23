CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`genre` text NOT NULL,
	`custom_genre` text,
	`tone` text NOT NULL,
	`difficulty` text NOT NULL,
	`world_description` text DEFAULT '' NOT NULL,
	`custom_rules` text,
	`campaign_journal` text,
	`story_state` text,
	`stat_definitions` text DEFAULT '[]' NOT NULL,
	`quick_actions` text DEFAULT '[]' NOT NULL,
	`plot_hooks` text DEFAULT '[]' NOT NULL,
	`image_style` text DEFAULT 'painterly-fantasy',
	`image_enabled` integer DEFAULT false,
	`custom_image_config` text,
	`last_played_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_campaigns_last_played` ON `campaigns` (`last_played_at`);--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`backstory` text NOT NULL,
	`stats` text NOT NULL,
	`inventory` text NOT NULL,
	`appearance` text,
	`status_notes` text,
	`portrait_url` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_characters_campaign` ON `characters` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`streaming_text` text,
	`is_streaming` integer DEFAULT false,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_session_created` ON `messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `npc_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`personality` text NOT NULL,
	`location` text NOT NULL,
	`relationships` text NOT NULL,
	`secrets` text NOT NULL,
	`revealed_info` text NOT NULL,
	`memory_log` text NOT NULL,
	`deep_history` text,
	`current_state` text NOT NULL,
	`speech_pattern` text,
	`vocabulary` text,
	`last_interacted_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_npc_memory_campaign` ON `npc_memory` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `idx_npc_memory_campaign_name` ON `npc_memory` (`campaign_id`,`name`);--> statement-breakpoint
CREATE TABLE `scene_images` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`trigger_type` text NOT NULL,
	`sd_prompt` text NOT NULL,
	`sd_negative_prompt` text NOT NULL,
	`file_path` text,
	`status` text DEFAULT 'generating' NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`progress` integer DEFAULT 0,
	`progress_phase` text DEFAULT 'preparing',
	`character_id` text,
	`context_snapshot` text,
	`generation_time_ms` integer,
	`seed` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_scene_images_message` ON `scene_images` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_scene_images_campaign_created` ON `scene_images` (`campaign_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_scene_images_session_created` ON `scene_images` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`context_summary` text,
	`status` text DEFAULT 'active' NOT NULL,
	`processing_started_at` integer,
	`last_pacing_beats` text,
	`last_summary_at` integer,
	`messages_since_event` integer DEFAULT 0,
	`consequence_seeds` text DEFAULT '[]' NOT NULL,
	`narrative_arc` text,
	`story_state` text,
	`scene_state` text,
	`last_image_message_count` integer,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_campaign_started` ON `sessions` (`campaign_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`provider` text DEFAULT 'ollama' NOT NULL,
	`ollama_base_url` text DEFAULT 'http://localhost:11434',
	`openai_api_key` text,
	`anthropic_api_key` text,
	`selected_model` text,
	`max_context_messages` integer DEFAULT 20,
	`created_at` integer NOT NULL
);
