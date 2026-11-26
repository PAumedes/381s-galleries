-- TIFF originals (T6.53d). Hand-written, as 0020-0023 (a plain ADD COLUMN: no
-- table rebuild, so every photos trigger of 0000-0017 is untouched; the
-- snapshot 0024_snapshot.json is kept by hand).
-- `drive_tiff_id` is the Drive file id of the photo's TIFF original, or NULL.
-- `drive_highres_id` stays NOT NULL: a TIFF-only photo (no JPEG high-res) holds
-- the TIFF's id in BOTH columns (`drive_tiff_id = drive_highres_id`), so every
-- reader that serves the original keeps working and the readers that turn
-- high-res into an IMAGE (previews, warm) must skip that case.
ALTER TABLE `photos` ADD `drive_tiff_id` text;
