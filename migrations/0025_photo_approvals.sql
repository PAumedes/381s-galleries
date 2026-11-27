-- Per-version approvals (T6.53f). Hand-written, as 0020-0024 (a new table only:
-- no table is rebuilt, so every trigger of 0000-0023 is untouched; the
-- snapshot 0025_snapshot.json is kept consistent with schema.ts).
--
-- One row = one visitor (the anonymous/email visitor of favorites, never an
-- account) approved one VERSION of one photo. A new version has no row, so it
-- starts "a revisar". Integrity: composite FKs to visitors and photos keep all
-- three in `gallery_id`; (photo_id, version) is an FK to photo_versions' key, so
-- the version must exist and its row going away (version grace, photo removal,
-- gallery delete) takes the approvals with it: no orphans. `version` is
-- checked with typeof like photo_versions.
CREATE TABLE `photo_approvals` (
	`gallery_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`version` integer NOT NULL,
	`visitor_id` text NOT NULL,
	`approved_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	PRIMARY KEY(`photo_id`, `version`, `visitor_id`),
	FOREIGN KEY (`gallery_id`,`visitor_id`) REFERENCES `visitors`(`gallery_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`gallery_id`,`photo_id`) REFERENCES `photos`(`gallery_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`photo_id`,`version`) REFERENCES `photo_versions`(`photo_id`,`version`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "photo_approvals_version_check" CHECK(typeof("photo_approvals"."version") = 'integer' AND "photo_approvals"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `photo_approvals_gallery_visitor_idx` ON `photo_approvals` (`gallery_id`,`visitor_id`);
