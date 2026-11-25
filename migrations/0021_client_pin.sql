-- Client PIN (T6.52): one optional PIN per client; entering it once opens every
-- album of that client for the visitor (albums with their own PIN still ask for
-- it). Same PBKDF2 hash format as galleries.pin_hash. Hand-written, as 0020:
-- drizzle-kit would drop the hand-written triggers of 0020 on regeneration, so
-- the snapshot (0021_snapshot.json) is kept consistent by hand. Deleting a
-- client deletes its row, and the hash with it.
ALTER TABLE `clients` ADD `pin_hash` text;
