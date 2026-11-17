DROP INDEX `visitors_gallery_email_nocase_unique`;--> statement-breakpoint
CREATE INDEX `visitors_gallery_email_nocase_idx` ON `visitors` (`gallery_id`,"email" COLLATE NOCASE);