-- Round ownership (T6.53b adversary round 2). Hand-written, as 0020-0022:
-- drizzle-kit would recreate delivery_rounds (dropping its BEFORE DELETE
-- trigger from 0022), so the snapshot (0023_snapshot.json) is kept by hand.
-- `folder_round` is N of the `v<N>/` folder that delivered the round, NULL for
-- a suffix delivery: folder and suffix rounds never share a row (the number
-- may differ from N when it was taken), and a deleted folder's round never
-- becomes a suffix round. One folder round per (gallery, N); NULLs do not
-- collide in the unique index.
ALTER TABLE `delivery_rounds` ADD `folder_round` integer CONSTRAINT `delivery_rounds_folder_round_check` CHECK(`folder_round` IS NULL OR (typeof(`folder_round`) = 'integer' AND `folder_round` >= 1));--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_rounds_gallery_folder_unique` ON `delivery_rounds` (`gallery_id`,`folder_round`);
