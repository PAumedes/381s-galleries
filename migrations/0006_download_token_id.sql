ALTER TABLE `downloads` ADD `token_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `downloads_token_id_idx` ON `downloads` (`token_id`);