ALTER TABLE `gallery_views` ADD `ip_hash` text;--> statement-breakpoint
CREATE INDEX `gallery_views_dedupe_idx` ON `gallery_views` (`gallery_id`,`ip_hash`,`created_at`);