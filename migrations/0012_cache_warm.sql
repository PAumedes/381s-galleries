ALTER TABLE `photos` ADD `cache_warm_key` text;--> statement-breakpoint
ALTER TABLE `photos` ADD `cache_expected_key` text;--> statement-breakpoint
ALTER TABLE `photos` ADD `cache_warm_fail_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `photos` ADD `cache_warm_retry_at` text;
--> statement-breakpoint
-- Cache-warm invalidation lives in the database so that every writer (sync,
-- admin toggle, scripts) is covered: a change of file ids / versions / the
-- gallery watermark flag forgets the expected key and the failure back-off and
-- bumps `warm_stamp` / clears `warm_idle`, which makes the warm cron look again.
CREATE TRIGGER `photos_warm_invalidate` AFTER UPDATE OF `drive_highres_id`, `drive_web_id`, `drive_ig_id`, `drive_thumb_id`, `drive_wm_id`, `variant_versions` ON `photos`
WHEN OLD.`drive_highres_id` IS NOT NEW.`drive_highres_id` OR OLD.`drive_web_id` IS NOT NEW.`drive_web_id` OR OLD.`drive_ig_id` IS NOT NEW.`drive_ig_id` OR OLD.`drive_thumb_id` IS NOT NEW.`drive_thumb_id` OR OLD.`drive_wm_id` IS NOT NEW.`drive_wm_id` OR OLD.`variant_versions` IS NOT NEW.`variant_versions`
BEGIN
  UPDATE `photos` SET `cache_expected_key` = NULL, `cache_warm_fail_count` = 0, `cache_warm_retry_at` = NULL WHERE `id` = NEW.`id`;
  DELETE FROM `settings` WHERE `key` = 'warm_idle';
  INSERT INTO `settings` (`key`, `value`) VALUES ('warm_stamp', lower(hex(randomblob(8)))) ON CONFLICT(`key`) DO UPDATE SET `value` = excluded.`value`;
END;
--> statement-breakpoint
CREATE TRIGGER `photos_warm_insert` AFTER INSERT ON `photos`
BEGIN
  DELETE FROM `settings` WHERE `key` = 'warm_idle';
  INSERT INTO `settings` (`key`, `value`) VALUES ('warm_stamp', lower(hex(randomblob(8)))) ON CONFLICT(`key`) DO UPDATE SET `value` = excluded.`value`;
END;
--> statement-breakpoint
CREATE TRIGGER `galleries_warm_watermark` AFTER UPDATE OF `use_watermark_preview` ON `galleries`
WHEN OLD.`use_watermark_preview` IS NOT NEW.`use_watermark_preview`
BEGIN
  UPDATE `photos` SET `cache_expected_key` = NULL, `cache_warm_fail_count` = 0, `cache_warm_retry_at` = NULL WHERE `gallery_id` = NEW.`id`;
  DELETE FROM `settings` WHERE `key` = 'warm_idle';
  INSERT INTO `settings` (`key`, `value`) VALUES ('warm_stamp', lower(hex(randomblob(8)))) ON CONFLICT(`key`) DO UPDATE SET `value` = excluded.`value`;
END;
