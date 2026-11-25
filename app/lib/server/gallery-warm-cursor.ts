/** The grid-walk cursor of the warm-on-open (gallery-warm.ts), kept in `settings`. */

/** Grid-order position of a photo: the keyset the cursor remembers. */
export type GridKey = [setName: string, sort: number, baseName: string];

export interface Cursor {
  phase: number;
  /** Last photo handled in this phase (null: from the start). */
  after: GridKey | null;
  /** A file failed during this pass: finishing it starts a new pass, not "done". */
  failed: boolean;
}

export const START: Cursor = { phase: 0, after: null, failed: false };

/** Stored cursor as JSON `{p, a, f, s}` (s = warm_stamp) or `{d: 1, s}`; anything else restarts. */
export function parseCursor(
  raw: string | undefined,
  stamp: string,
): Cursor | "done" {
  try {
    const c = JSON.parse(raw ?? "") as Record<string, unknown>;
    if (c.s !== stamp) return START;
    if (c.d === 1) return "done";
    const a = c.a;
    const after =
      Array.isArray(a) &&
      a.length === 3 &&
      typeof a[0] === "string" &&
      typeof a[1] === "number" &&
      typeof a[2] === "string"
        ? (a as GridKey)
        : null;
    if (!Number.isInteger(c.p) || (c.p as number) < 0) return START;
    return { phase: c.p as number, after, failed: c.f === 1 };
  } catch {
    return START;
  }
}

export function serializeCursor(c: Cursor | "done", stamp: string): string {
  return JSON.stringify(
    c === "done"
      ? { d: 1, s: stamp }
      : { p: c.phase, a: c.after, f: c.failed ? 1 : 0, s: stamp },
  );
}

/**
 * Stores the cursor, only while the gallery still exists: a delete that ran
 * meanwhile must not be followed by a stray cursor row.
 */
export async function saveCursor(
  env: Env,
  key: string,
  galleryId: string,
  cursor: Cursor | "done",
  stamp: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM galleries WHERE id = ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(key, serializeCursor(cursor, stamp), galleryId)
    .run();
}
