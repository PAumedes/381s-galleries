-- Visitor data (owner decision: raw IP addresses are NEVER stored; whatever else
-- we keep is hashed or coarse). All columns nullable (old rows stay NULL);
-- column-level CHECKs cap every length and constrain the device enum, as in
-- 0014 / 0017 (drizzle-kit does not model column CHECKs: the snapshot only has
-- the columns). `ip_hash` is the keyed one-way hash already used by gallery_views.
ALTER TABLE `downloads` ADD `ip_hash` text CHECK(`ip_hash` IS NULL OR length(`ip_hash`) <= 64);--> statement-breakpoint
ALTER TABLE `downloads` ADD `region` text CHECK(`region` IS NULL OR length(`region`) <= 100);--> statement-breakpoint
ALTER TABLE `downloads` ADD `city` text CHECK(`city` IS NULL OR length(`city`) <= 100);--> statement-breakpoint
ALTER TABLE `downloads` ADD `continent` text CHECK(`continent` IS NULL OR length(`continent`) <= 2);--> statement-breakpoint
ALTER TABLE `downloads` ADD `timezone` text CHECK(`timezone` IS NULL OR length(`timezone`) <= 64);--> statement-breakpoint
ALTER TABLE `downloads` ADD `asn` integer CHECK(`asn` IS NULL OR (`asn` >= 0 AND `asn` <= 4294967295));--> statement-breakpoint
ALTER TABLE `downloads` ADD `as_org` text CHECK(`as_org` IS NULL OR length(`as_org`) <= 100);--> statement-breakpoint
ALTER TABLE `downloads` ADD `lang` text CHECK(`lang` IS NULL OR length(`lang`) <= 35);--> statement-breakpoint
ALTER TABLE `downloads` ADD `referrer_host` text CHECK(`referrer_host` IS NULL OR length(`referrer_host`) <= 253);--> statement-breakpoint
ALTER TABLE `downloads` ADD `browser` text CHECK(`browser` IS NULL OR length(`browser`) <= 40);--> statement-breakpoint
ALTER TABLE `downloads` ADD `browser_version` text CHECK(`browser_version` IS NULL OR length(`browser_version`) <= 10);--> statement-breakpoint
ALTER TABLE `downloads` ADD `os` text CHECK(`os` IS NULL OR length(`os`) <= 40);--> statement-breakpoint
ALTER TABLE `downloads` ADD `device` text CHECK(`device` IS NULL OR `device` IN ('mobile','tablet','desktop','bot','unknown'));--> statement-breakpoint
ALTER TABLE `gallery_views` ADD `region` text CHECK(`region` IS NULL OR length(`region`) <= 100);--> statement-breakpoint
ALTER TABLE `gallery_views` ADD `city` text CHECK(`city` IS NULL OR length(`city`) <= 100);--> statement-breakpoint
ALTER TABLE `gallery_views` ADD `continent` text CHECK(`continent` IS NULL OR length(`continent`) <= 2);--> statement-breakpoint
ALTER TABLE `gallery_views` ADD `timezone` text CHECK(`timezone` IS NULL OR length(`timezone`) <= 64);--> statement-breakpoint
ALTER TABLE `gallery_views` ADD `asn` integer CHECK(`asn` IS NULL OR (`asn` >= 0 AND `asn` <= 4294967295));--> statement-breakpoint
ALTER TABLE `gallery_views` ADD `as_org` text CHECK(`as_org` IS NULL OR length(`as_org`) <= 100);--> statement-breakpoint
ALTER TABLE `gallery_views` ADD `lang` text CHECK(`lang` IS NULL OR length(`lang`) <= 35);--> statement-breakpoint
ALTER TABLE `gallery_views` ADD `referrer_host` text CHECK(`referrer_host` IS NULL OR length(`referrer_host`) <= 253);--> statement-breakpoint
ALTER TABLE `gallery_views` ADD `browser` text CHECK(`browser` IS NULL OR length(`browser`) <= 40);--> statement-breakpoint
ALTER TABLE `gallery_views` ADD `browser_version` text CHECK(`browser_version` IS NULL OR length(`browser_version`) <= 10);--> statement-breakpoint
ALTER TABLE `gallery_views` ADD `os` text CHECK(`os` IS NULL OR length(`os`) <= 40);--> statement-breakpoint
ALTER TABLE `gallery_views` ADD `device` text CHECK(`device` IS NULL OR `device` IN ('mobile','tablet','desktop','bot','unknown'));
