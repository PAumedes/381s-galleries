-- Cover focal point (percent 0-100, object-position on the public cover); NULL = centered.
ALTER TABLE `galleries` ADD `cover_focus_x` real CHECK(`cover_focus_x` IS NULL OR (`cover_focus_x` >= 0 AND `cover_focus_x` <= 100));--> statement-breakpoint
ALTER TABLE `galleries` ADD `cover_focus_y` real CHECK(`cover_focus_y` IS NULL OR (`cover_focus_y` >= 0 AND `cover_focus_y` <= 100));
