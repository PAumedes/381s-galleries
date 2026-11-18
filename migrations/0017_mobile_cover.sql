-- Optional per-device cover (admin redesign): a mobile cover photo with its own
-- focal point, used on narrow viewports. NULL = the desktop cover with its own
-- focal point. Same rules as the desktop columns (0000 triggers, 0014 CHECKs).
ALTER TABLE `galleries` ADD `cover_photo_id_mobile` text;--> statement-breakpoint
ALTER TABLE `galleries` ADD `cover_focus_mobile_x` real CHECK(`cover_focus_mobile_x` IS NULL OR (`cover_focus_mobile_x` >= 0 AND `cover_focus_mobile_x` <= 100));--> statement-breakpoint
ALTER TABLE `galleries` ADD `cover_focus_mobile_y` real CHECK(`cover_focus_mobile_y` IS NULL OR (`cover_focus_mobile_y` >= 0 AND `cover_focus_mobile_y` <= 100));--> statement-breakpoint
-- MANUAL BLOCK (drizzle-kit does not manage triggers): the mobile cover must be
-- a photo of the same gallery, and is cleared (with its focal point) when that
-- photo is deleted. Hidden photos (missing_since) are filtered at query time.
CREATE TRIGGER `galleries_cover_mobile_insert_check` BEFORE INSERT ON `galleries`
WHEN NEW.`cover_photo_id_mobile` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `photos` WHERE `id` = NEW.`cover_photo_id_mobile` AND `gallery_id` = NEW.`id`)
BEGIN
	SELECT RAISE(ABORT, 'cover_photo_id_mobile must reference a photo of the same gallery');
END;--> statement-breakpoint
CREATE TRIGGER `galleries_cover_mobile_update_check` BEFORE UPDATE OF `cover_photo_id_mobile` ON `galleries`
WHEN NEW.`cover_photo_id_mobile` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `photos` WHERE `id` = NEW.`cover_photo_id_mobile` AND `gallery_id` = NEW.`id`)
BEGIN
	SELECT RAISE(ABORT, 'cover_photo_id_mobile must reference a photo of the same gallery');
END;--> statement-breakpoint
CREATE TRIGGER `photos_clear_cover_mobile_on_delete` AFTER DELETE ON `photos`
BEGIN
	UPDATE `galleries` SET `cover_photo_id_mobile` = NULL, `cover_focus_mobile_x` = NULL, `cover_focus_mobile_y` = NULL
	WHERE `id` = OLD.`gallery_id` AND `cover_photo_id_mobile` = OLD.`id`;
END;
--> statement-breakpoint
-- Moving a photo to another gallery must not leave it as a cross-gallery
-- mobile cover of the gallery it left: clear it (with its focal point).
CREATE TRIGGER `photos_clear_cover_mobile_on_move` AFTER UPDATE OF `gallery_id` ON `photos`
WHEN OLD.`gallery_id` <> NEW.`gallery_id`
BEGIN
	UPDATE `galleries` SET `cover_photo_id_mobile` = NULL, `cover_focus_mobile_x` = NULL, `cover_focus_mobile_y` = NULL
	WHERE `id` = OLD.`gallery_id` AND `cover_photo_id_mobile` = OLD.`id`;
END;
