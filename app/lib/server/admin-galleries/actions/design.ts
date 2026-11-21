import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import {
  isCoverLayout,
  isGridGap,
  isGridStyle,
  isPalette,
} from "../../../design";
import { done, fail } from "./shared";
import type { GalleryRow } from "./shared";

/** Design (T6.5): enums only; an absent key keeps the stored value. */
export async function saveDesign(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
) {
  const intent = "design";
  const pick = <T extends string>(
    key: string,
    ok: (v: unknown) => v is T,
    current: T,
    msg: string,
    errors: Record<string, string>,
  ): T => {
    const raw = f.get(key);
    if (raw === null) return current;
    if (typeof raw === "string" && ok(raw)) return raw;
    errors[key] = msg;
    return current;
  };
  const errors: Record<string, string> = {};
  const palette = pick(
    "palette",
    isPalette,
    g.palette,
    t("admin.msg.paletteInvalid"),
    errors,
  );
  const coverLayout = pick(
    "coverLayout",
    isCoverLayout,
    g.coverLayout,
    t("admin.msg.coverLayoutInvalid"),
    errors,
  );
  const gridStyle = pick(
    "gridStyle",
    isGridStyle,
    g.gridStyle,
    t("admin.msg.gridStyleInvalid"),
    errors,
  );
  const gridGap = pick(
    "gridGap",
    isGridGap,
    g.gridGap,
    t("admin.msg.gridGapInvalid"),
    errors,
  );
  if (Object.keys(errors).length)
    return fail(intent, t("admin.msg.checkFields"), errors);
  await getDb(env)
    .update(schema.galleries)
    .set({ palette, coverLayout, gridStyle, gridGap })
    .where(eq(schema.galleries.id, g.id));
  return done(intent, t("admin.msg.designSaved"));
}
