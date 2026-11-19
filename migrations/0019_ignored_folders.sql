-- Tombstones for deleted galleries (owner decision: deleting a gallery deletes ALL
-- data associated with it; the only thing kept is the Drive folder identifier, so
-- the next sync does not re-create the gallery from that folder). No title, no
-- slug, no visitor data. Removing a row ("Volver a incluir") lets sync re-create
-- the gallery from scratch. A row whose folder still has a gallery row means
-- "deletion in progress": that gallery is hidden and sync leaves it alone.
CREATE TABLE `ignored_folders` (
	`drive_folder_id` text PRIMARY KEY NOT NULL,
	`deleted_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL
);
