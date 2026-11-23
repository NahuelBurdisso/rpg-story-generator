CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`npc_id` text NOT NULL,
	`about` text NOT NULL,
	`kind` text DEFAULT 'episodic' NOT NULL,
	`content` text NOT NULL,
	`valence` integer NOT NULL,
	`salience_base` integer NOT NULL,
	`source` text DEFAULT 'witnessed' NOT NULL,
	`confidence` integer DEFAULT 100 NOT NULL,
	`thread_id` text,
	`session_id` text,
	`message_id` text,
	`introduced_turn` integer NOT NULL,
	`last_reinforced_turn` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`npc_id`) REFERENCES `npc_memory`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_memories_npc_status` ON `memories` (`npc_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_memories_campaign` ON `memories` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `idx_memories_thread` ON `memories` (`thread_id`);