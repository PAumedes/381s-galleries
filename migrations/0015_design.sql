-- Per-gallery client design (T6.5). Plain ADD COLUMNs with CHECKs (no table
-- rebuild: photos/favorites/downloads reference galleries with ON DELETE
-- CASCADE, and rebuilding galleries to relax the 0010 `theme` CHECK is risky).
-- `palette` replaces `theme`: the legacy column stays, unused, with its
-- original ('light','dark') CHECK.
ALTER TABLE `galleries` ADD `palette` text DEFAULT 'claro' NOT NULL CHECK(`palette` IN ('claro','oscuro','arena','gris'));--> statement-breakpoint
ALTER TABLE `galleries` ADD `cover_layout` text DEFAULT 'completa' NOT NULL CHECK(`cover_layout` IN ('completa','dividida','centrada','minima'));--> statement-breakpoint
ALTER TABLE `galleries` ADD `grid_style` text DEFAULT 'filas' NOT NULL CHECK(`grid_style` IN ('filas','cuadricula','columnas'));--> statement-breakpoint
ALTER TABLE `galleries` ADD `grid_gap` text DEFAULT 'normal' NOT NULL CHECK(`grid_gap` IN ('compacto','normal','amplio'));--> statement-breakpoint
UPDATE `galleries` SET `palette` = CASE `theme` WHEN 'dark' THEN 'oscuro' ELSE 'claro' END;
