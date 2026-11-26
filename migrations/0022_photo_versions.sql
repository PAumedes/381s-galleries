-- Photo versions (T6.53a). Hand-written, as 0020/0021: drizzle-kit would drop
-- the hand-written triggers of 0020/0021 on regeneration, so the snapshot
-- (0022_snapshot.json) is kept consistent by hand and nothing of 0020/0021 is
-- touched here.
--
-- `photos` stays the logical row (stable id = stable URLs, favorites, R2 keys)
-- and keeps mirroring the LATEST version's columns, so no existing query
-- changes. `photo_versions` holds one row per (photo, version); the backfill
-- below gives every existing photo its v1 mirroring the current columns.
-- Rows for photos synced AFTER this migration are written by the sync parser
-- (T6.53b); nothing reads this table before then.
--
-- Delete rule: photo_versions.photo_id cascades from photos, delivery_rounds
-- .gallery_id cascades from galleries (sync's photo removal and the gallery
-- delete both reach them); deleteGallery also deletes both explicitly (the
-- "ALL data is deleted" rule does not rest on the cascade alone). Deleting a
-- round alone keeps its versions (round_id -> NULL).
ALTER TABLE `galleries` ADD `versioning` integer DEFAULT 0 NOT NULL CONSTRAINT `galleries_versioning_bool_check` CHECK(`versioning` IN (0,1));--> statement-breakpoint
CREATE TABLE `delivery_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`gallery_id` text NOT NULL,
	`number` integer NOT NULL,
	`name` text,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	FOREIGN KEY (`gallery_id`) REFERENCES `galleries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "delivery_rounds_number_check" CHECK("delivery_rounds"."number" >= 1),
	CONSTRAINT "delivery_rounds_name_check" CHECK("delivery_rounds"."name" IS NULL OR length("delivery_rounds"."name") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_rounds_gallery_number_unique` ON `delivery_rounds` (`gallery_id`,`number`);--> statement-breakpoint
CREATE TABLE `photo_versions` (
	`photo_id` text NOT NULL,
	`version` integer NOT NULL,
	`round_id` text,
	`drive_highres_id` text NOT NULL,
	`drive_web_id` text,
	`drive_ig_id` text,
	`drive_thumb_id` text,
	`drive_wm_id` text,
	`drive_thumb_wm_id` text,
	`drive_tiff_id` text,
	`highres_bytes` integer,
	`drive_versions` text,
	`width` integer,
	`height` integer,
	`first_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	PRIMARY KEY(`photo_id`, `version`),
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `delivery_rounds`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "photo_versions_version_check" CHECK("photo_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `photo_versions_round_id_idx` ON `photo_versions` (`round_id`);--> statement-breakpoint
-- Backfill: one v1 row per existing photo, mirroring its current columns.
INSERT INTO `photo_versions` (`photo_id`, `version`, `drive_highres_id`, `drive_web_id`, `drive_ig_id`, `drive_thumb_id`, `drive_wm_id`, `drive_thumb_wm_id`, `highres_bytes`, `drive_versions`, `width`, `height`)
SELECT `id`, 1, `drive_highres_id`, `drive_web_id`, `drive_ig_id`, `drive_thumb_id`, `drive_wm_id`, `drive_thumb_wm_id`, `highres_bytes`, `variant_versions`, `width`, `height` FROM `photos`;
