-- One switch per gallery replaces use_watermark_preview:
--   'proofing' (Prueba): every public image watermarked, downloads refused.
--   'delivery' (Entrega): clean images, downloads per allow_* flags.
-- Plain ADD COLUMNs (no table rebuild: photos/favorites/downloads reference
-- galleries with ON DELETE CASCADE). The legacy use_watermark_preview column
-- stays, unused.
ALTER TABLE `galleries` ADD `mode` text DEFAULT 'delivery' NOT NULL CHECK(`mode` IN ('proofing','delivery'));--> statement-breakpoint
ALTER TABLE `photos` ADD `drive_thumb_wm_id` text;--> statement-breakpoint
UPDATE `galleries` SET `mode` = CASE WHEN `use_watermark_preview` = 1 THEN 'proofing' ELSE 'delivery' END;--> statement-breakpoint
-- The warm triggers of 0012 watched use_watermark_preview: recreate them on
-- `mode`, and let photos_warm_invalidate also watch the thumb-wm file.
DROP TRIGGER IF EXISTS `galleries_warm_watermark`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `photos_warm_invalidate`;--> statement-breakpoint
CREATE TRIGGER `photos_warm_invalidate` AFTER UPDATE OF `drive_highres_id`, `drive_web_id`, `drive_ig_id`, `drive_thumb_id`, `drive_wm_id`, `drive_thumb_wm_id`, `variant_versions` ON `photos`
WHEN OLD.`drive_highres_id` IS NOT NEW.`drive_highres_id` OR OLD.`drive_web_id` IS NOT NEW.`drive_web_id` OR OLD.`drive_ig_id` IS NOT NEW.`drive_ig_id` OR OLD.`drive_thumb_id` IS NOT NEW.`drive_thumb_id` OR OLD.`drive_wm_id` IS NOT NEW.`drive_wm_id` OR OLD.`drive_thumb_wm_id` IS NOT NEW.`drive_thumb_wm_id` OR OLD.`variant_versions` IS NOT NEW.`variant_versions`
BEGIN
  UPDATE `photos` SET `cache_expected_key` = NULL, `cache_warm_fail_count` = 0, `cache_warm_retry_at` = NULL WHERE `id` = NEW.`id`;
  DELETE FROM `settings` WHERE `key` = 'warm_idle';
  INSERT INTO `settings` (`key`, `value`) VALUES ('warm_stamp', lower(hex(randomblob(8)))) ON CONFLICT(`key`) DO UPDATE SET `value` = excluded.`value`;
END;
--> statement-breakpoint
CREATE TRIGGER `galleries_warm_mode` AFTER UPDATE OF `mode` ON `galleries`
WHEN OLD.`mode` IS NOT NEW.`mode`
BEGIN
  UPDATE `photos` SET `cache_expected_key` = NULL, `cache_warm_fail_count` = 0, `cache_warm_retry_at` = NULL WHERE `gallery_id` = NEW.`id`;
  DELETE FROM `settings` WHERE `key` = 'warm_idle';
  INSERT INTO `settings` (`key`, `value`) VALUES ('warm_stamp', lower(hex(randomblob(8)))) ON CONFLICT(`key`) DO UPDATE SET `value` = excluded.`value`;
END;
