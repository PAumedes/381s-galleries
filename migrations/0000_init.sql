CREATE TABLE `downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`gallery_id` text NOT NULL,
	`photo_id` text,
	`visitor_id` text,
	`variant` text NOT NULL,
	`kind` text NOT NULL,
	`country` text,
	`ua` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `downloads_gallery_created_idx` ON `downloads` (`gallery_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `favorites` (
	`visitor_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`list_name` text DEFAULT 'Favoritos' NOT NULL,
	`comment` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	PRIMARY KEY(`visitor_id`, `photo_id`, `list_name`),
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `galleries` (
	`id` text PRIMARY KEY NOT NULL,
	`drive_folder_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`client_name` text,
	`event_date` text,
	`pin_hash` text,
	`expires_at` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`cover_photo_id` text,
	`allow_highres` integer DEFAULT true NOT NULL,
	`allow_web` integer DEFAULT true NOT NULL,
	`allow_ig` integer DEFAULT true NOT NULL,
	`allow_bulk` integer DEFAULT true NOT NULL,
	`require_email` integer DEFAULT true NOT NULL,
	`use_watermark_preview` integer DEFAULT false NOT NULL,
	`drive_modified_at` text,
	`last_synced_at` text,
	`sync_issues_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `galleries_drive_folder_id_unique` ON `galleries` (`drive_folder_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `galleries_slug_unique` ON `galleries` (`slug`);--> statement-breakpoint
CREATE TABLE `gallery_views` (
	`gallery_id` text NOT NULL,
	`visitor_id` text,
	`country` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gallery_views_gallery_created_idx` ON `gallery_views` (`gallery_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`gallery_id` text NOT NULL,
	`set_name` text DEFAULT 'Highlights' NOT NULL,
	`base_name` text NOT NULL,
	`drive_highres_id` text NOT NULL,
	`drive_web_id` text,
	`drive_ig_id` text,
	`drive_thumb_id` text,
	`drive_wm_id` text,
	`highres_bytes` integer,
	`width` integer,
	`height` integer,
	`taken_at` text,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`gallery_id`) REFERENCES `galleries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photos_gallery_set_sort_idx` ON `photos` (`gallery_id`,`set_name`,`sort`);--> statement-breakpoint
CREATE UNIQUE INDEX `photos_gallery_set_base_unique` ON `photos` (`gallery_id`,`set_name`,`base_name`);--> statement-breakpoint
CREATE TABLE `pin_attempts` (
	`ip_hash` text NOT NULL,
	`gallery_id` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_start` text NOT NULL,
	PRIMARY KEY(`ip_hash`, `gallery_id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visitors` (
	`id` text PRIMARY KEY NOT NULL,
	`gallery_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`first_seen` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	FOREIGN KEY (`gallery_id`) REFERENCES `galleries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visitors_gallery_email_unique` ON `visitors` (`gallery_id`,`email`);