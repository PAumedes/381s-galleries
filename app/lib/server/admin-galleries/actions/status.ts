import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { scheduleWarmAtPublish } from "../../gallery-warm";
import { done, fail } from "./shared";
import type { GalleryActionDeps, GalleryRow } from "./shared";

export async function changeStatus(
  env: Env,
  g: GalleryRow,
  to: string,
  t: TFunction,
  deps?: GalleryActionDeps,
) {
  const intent = "status";
  const db = getDb(env);
  let from: GalleryRow["status"];
  let set: Partial<typeof schema.galleries.$inferInsert>;
  let message: string;
  switch (to) {
    case "publish":
      from = "draft";
      set = { status: "published" }; // show_on_home stays 0: needs a new opt-in
      message = t("admin.msg.published");
      break;
    case "draft":
      from = "published";
      set = { status: "draft", showOnHome: false };
      message = t("admin.msg.movedToDraft");
      break;
    case "archive":
      if (g.status === "archived") return stale();
      from = g.status;
      set = {
        status: "archived",
        showOnHome: false,
        archivedPrevStatus: g.status,
        archivedBySync: false,
      };
      message = t("admin.msg.archived");
      break;
    case "restore":
      from = "archived";
      set = {
        status: g.archivedPrevStatus ?? "draft",
        archivedPrevStatus: null,
        archivedBySync: false,
      };
      message = t("admin.msg.restored");
      break;
    default:
      return fail(intent, t("admin.msg.unknownAction"));
  }
  function stale() {
    return fail(intent, t("admin.msg.stale"));
  }
  if (g.status !== from) return stale();
  // Compare-and-set: a concurrent change makes this a no-op instead of a clobber.
  const res = await db
    .update(schema.galleries)
    .set(set)
    .where(
      and(eq(schema.galleries.id, g.id), eq(schema.galleries.status, from)),
    )
    .returning({ id: schema.galleries.id });
  if (!res.length) return stale();
  // Now visible to clients: fill R2 (cover first) before the first visitor.
  if (set.status === "published") scheduleWarmAtPublish(env, deps, g.id);
  return done(intent, message);
}
