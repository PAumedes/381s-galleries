import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { scheduleWarmAtPublish } from "../../gallery-warm";
import { done, fail } from "./shared";
import type { GalleryActionDeps, GalleryRow } from "./shared";

type Transition = {
  from: GalleryRow["status"];
  set: Partial<typeof schema.galleries.$inferInsert>;
  message: string;
};

/** What each status action changes, and the status it may start from; null for an unknown or already-applied one. */
function transitionFor(
  g: GalleryRow,
  to: string,
  t: TFunction,
): Transition | "stale" | null {
  switch (to) {
    case "publish":
      // show_on_home stays 0: needs a new opt-in
      return {
        from: "draft",
        set: { status: "published" },
        message: t("admin.msg.published"),
      };
    case "draft":
      return {
        from: "published",
        set: { status: "draft", showOnHome: false },
        message: t("admin.msg.movedToDraft"),
      };
    case "archive":
      if (g.status === "archived") return "stale";
      return {
        from: g.status,
        set: {
          status: "archived",
          showOnHome: false,
          archivedPrevStatus: g.status,
          archivedBySync: false,
        },
        message: t("admin.msg.archived"),
      };
    case "restore":
      return {
        from: "archived",
        set: {
          status: g.archivedPrevStatus ?? "draft",
          archivedPrevStatus: null,
          archivedBySync: false,
        },
        message: t("admin.msg.restored"),
      };
    default:
      return null;
  }
}

export async function changeStatus(
  env: Env,
  g: GalleryRow,
  to: string,
  t: TFunction,
  deps?: GalleryActionDeps,
) {
  const intent = "status";
  const stale = () => fail(intent, t("admin.msg.stale"));
  const tr = transitionFor(g, to, t);
  if (!tr) return fail(intent, t("admin.msg.unknownAction"));
  if (tr === "stale") return stale();
  const { from, set, message } = tr;
  if (g.status !== from) return stale();
  // Compare-and-set: a concurrent change makes this a no-op instead of a clobber.
  const res = await getDb(env)
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
