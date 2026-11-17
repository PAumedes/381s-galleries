CREATE INDEX `downloads_gallery_bulk_idx` ON `downloads` (`gallery_id`,`bulk_id`);--> statement-breakpoint
CREATE INDEX `favorites_gallery_visitor_idx` ON `favorites` (`gallery_id`,`visitor_id`);