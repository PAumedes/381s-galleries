import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../../../db";
import type { Db } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { photoSetVersion } from "../edit";
import { done, fail, str } from "./shared";
import type { GalleryRow } from "./shared";

type BatchItem = Parameters<Db["batch"]>[0][number];

/** Per id: 1 (WHEN) + 1 (IN) bound params, sort is an inlined integer; +1 gallery id = 91 < D1 limit 100. */
export const REORDER_CHUNK = 45;
const ORDER_MAX_CHARS = 2_000_000;

function parseOrder(raw: string): Record<string, string[]> | null {
  if (!raw || raw.length > ORDER_MAX_CHARS) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string[]> = Object.create(null);
  for (const [k, ids] of Object.entries(v)) {
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string"))
      return null;
    out[k] = ids as string[];
  }
  return out;
}

export async function reorder(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
) {
  const intent = "reorder";
  const db = getDb(env);
  const order = parseOrder(str(f, "order"));
  if (!order) return fail(intent, t("admin.msg.orderInvalid"));
  const current = await db
    .select({
      id: schema.photos.id,
      set: schema.photos.setName,
      sort: schema.photos.sort,
    })
    .from(schema.photos)
    .where(and(eq(schema.photos.galleryId, g.id), photoVisible));
  if ((await photoSetVersion(current.map((p) => p.id))) !== str(f, "version"))
    return fail(intent, t("admin.msg.orderStale"), undefined, { stale: true });
  const byId = new Map(current.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const writes: { id: string; sort: number }[] = [];
  for (const [set, ids] of Object.entries(order)) {
    for (const [i, pid] of ids.entries()) {
      const p = byId.get(pid);
      if (!p || p.set !== set || seen.has(pid))
        return fail(intent, t("admin.msg.orderInvalid"));
      seen.add(pid);
      if (p.sort !== i) writes.push({ id: pid, sort: i });
    }
  }
  if (seen.size !== byId.size) return fail(intent, t("admin.msg.orderInvalid"));

  // One CASE update per chunk, all chunks in a single batch (a D1 batch is a
  // transaction), so a failure never leaves a half-applied order.
  const stmts: BatchItem[] = [];
  for (let i = 0; i < writes.length; i += REORDER_CHUNK) {
    const part = writes.slice(i, i + REORDER_CHUNK);
    const cases = sql.join(
      part.map(
        (w) => sql`WHEN ${w.id} THEN ${sql.raw(String(Math.trunc(w.sort)))}`,
      ),
      sql` `,
    );
    stmts.push(
      db
        .update(schema.photos)
        .set({ sort: sql`CASE ${schema.photos.id} ${cases} END` })
        .where(
          and(
            eq(schema.photos.galleryId, g.id),
            inArray(
              schema.photos.id,
              part.map((w) => w.id),
            ),
          ),
        ),
    );
  }
  if (stmts.length) await db.batch(stmts as [BatchItem, ...BatchItem[]]);
  return done(intent, t("admin.msg.orderSaved"));
}
