-- Public portfolio home (T6.6): "Mostrar en la portada". Plain ADD COLUMN with a
-- CHECK (no table rebuild). Default 0: nothing is public until the owner opts in.
ALTER TABLE `galleries` ADD `show_on_home` integer DEFAULT 0 NOT NULL CHECK(`show_on_home` IN (0,1));
