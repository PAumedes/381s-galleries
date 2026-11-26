/**
 * D1 side of photo versions (T6.53b): reads the rounds and version rows of
 * the versioned galleries, then plans the statements that bring them in line
 * with the scanned state. Only galleries with `versioning = 1` come here, so
 * every other album keeps its exact query count. Server-only: Drive ids stay
 * in these rows.
 */
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "../../db";
import { D1_IN_CHUNK, VERSION_INSERT_ROWS } from "./d1-limits";
import { chunk, photoFields } from "./sync-helpers";
import type { PhotoDraft } from "./sync-helpers";
import type { BatchItem, Db, SyncRun } from "./sync-types";

/** Versions of one delivery that arrive within this long of the round's last arrival join the round (quiet window). */
export const ROUND_WINDOW_MS = 60 * 60_000;

export interface VersionState {
  rounds: (typeof schema.deliveryRounds.$inferSelect)[];
  versions: (typeof schema.photoVersions.$inferSelect)[];
}

/** One query for the rounds and one for the version rows of every versioned gallery (chunked by 90 galleries). */
export async function loadVersionState(
  { db, op }: SyncRun,
  galleryIds: string[],
): Promise<Map<string, VersionState>> {
  const state = new Map<string, VersionState>();
  const of = (id: string) => {
    const s = state.get(id) ?? { rounds: [], versions: [] };
    state.set(id, s);
    return s;
  };
  for (const ids of chunk(galleryIds, D1_IN_CHUNK)) {
    op(2);
    for (const r of await db
      .select()
      .from(schema.deliveryRounds)
      .where(inArray(schema.deliveryRounds.galleryId, ids)))
      of(r.galleryId).rounds.push(r);
    for (const v of await db
      .select()
      .from(schema.photoVersions)
      .where(inArray(schema.photoVersions.galleryId, ids)))
      of(v.galleryId).versions.push(v);
  }
  return state;
}

/** The photo_versions columns of one scanned version (same values `photos` mirrors for the latest). */
function versionFields(d: PhotoDraft) {
  const f = photoFields(d);
  return {
    driveHighresId: f.driveHighresId,
    driveWebId: f.driveWebId,
    driveIgId: f.driveIgId,
    driveThumbId: f.driveThumbId,
    driveWmId: f.driveWmId,
    driveThumbWmId: f.driveThumbWmId,
    highresBytes: f.highresBytes,
    driveVersions: f.variantVersions,
    width: f.width,
    height: f.height,
  };
}

/**
 * Delivery rounds of one gallery during one sync: a `v<N>/` folder is round N
 * exactly; suffix deliveries share the latest round while it is still within
 * the quiet window, else open the next number (never below 2: v1 is the
 * initial delivery and has no round).
 */
class RoundPlan {
  readonly inserts: BatchItem[] = [];
  private readonly rounds = new Map<number, { id: string; lastSeen: string }>();
  private windowId: string | undefined;

  constructor(
    private readonly db: Db,
    private readonly galleryId: string,
    private readonly syncedAt: string,
    state: VersionState,
  ) {
    for (const r of state.rounds)
      this.rounds.set(r.number, { id: r.id, lastSeen: r.startedAt });
    const byId = new Map([...this.rounds.values()].map((r) => [r.id, r]));
    for (const v of state.versions) {
      const r = v.roundId ? byId.get(v.roundId) : undefined;
      if (r && v.firstSeenAt > r.lastSeen) r.lastSeen = v.firstSeenAt;
    }
  }

  private open(number: number): string {
    const id = crypto.randomUUID();
    this.rounds.set(number, { id, lastSeen: this.syncedAt });
    this.inserts.push(
      this.db.insert(schema.deliveryRounds).values({
        id,
        galleryId: this.galleryId,
        number,
        startedAt: this.syncedAt,
      }),
    );
    return id;
  }

  forFolder(number: number): string {
    return this.rounds.get(number)?.id ?? this.open(number);
  }

  forWindow(): string {
    if (this.windowId) return this.windowId;
    const numbers = [...this.rounds.keys()];
    const latest = numbers.length ? Math.max(...numbers) : undefined;
    const last = latest === undefined ? undefined : this.rounds.get(latest)!;
    const joins =
      last !== undefined &&
      Date.parse(this.syncedAt) - Date.parse(last.lastSeen) <= ROUND_WINDOW_MS;
    this.windowId = joins ? last.id : this.open(Math.max(latest ?? 1, 1) + 1);
    return this.windowId;
  }
}

export interface VersionTarget {
  photoId: string;
  draft: PhotoDraft;
}

/**
 * Statements for one versioned gallery. `before` (rounds, deletes, updates)
 * can run any time ahead of the photo inserts; `after` inserts the new
 * version rows and must follow the inserts of new photos (composite FK).
 * Every version of every photo is compared, so a v1 row missing or stale
 * (album synced before versioning was switched on) is re-derived here.
 */
export function versionStatements(
  { db }: SyncRun,
  galleryId: string,
  syncedAt: string,
  targets: VersionTarget[],
  state: VersionState,
): { before: BatchItem[]; after: BatchItem[] } {
  const plan = new RoundPlan(db, galleryId, syncedAt, state);
  const have = new Map<string, Map<number, VersionState["versions"][number]>>();
  for (const v of state.versions) {
    const m = have.get(v.photoId) ?? new Map();
    m.set(v.version, v);
    have.set(v.photoId, m);
  }
  const changes: BatchItem[] = [];
  const fresh: (typeof schema.photoVersions.$inferInsert)[] = [];
  for (const { photoId, draft } of targets) {
    const rows = have.get(photoId) ?? new Map();
    const wanted = new Set<number>();
    for (const { version, draft: d } of draft.versions ?? []) {
      wanted.add(version);
      const f = versionFields(d);
      const row = rows.get(version);
      if (!row)
        fresh.push({
          photoId,
          galleryId,
          version,
          roundId:
            version < 2
              ? null
              : d.round !== undefined
                ? plan.forFolder(d.round)
                : plan.forWindow(),
          ...f,
          firstSeenAt: syncedAt,
        });
      else if (
        (Object.keys(f) as (keyof typeof f)[]).some((c) => row[c] !== f[c])
      )
        changes.push(
          db
            .update(schema.photoVersions)
            .set(f)
            .where(
              and(
                eq(schema.photoVersions.photoId, photoId),
                eq(schema.photoVersions.version, version),
              ),
            ),
        );
    }
    for (const gone of chunk(
      [...rows.keys()].filter((v) => !wanted.has(v)),
      D1_IN_CHUNK,
    ))
      changes.push(
        db
          .delete(schema.photoVersions)
          .where(
            and(
              eq(schema.photoVersions.photoId, photoId),
              inArray(schema.photoVersions.version, gone),
            ),
          ),
      );
  }
  return {
    before: [...plan.inserts, ...changes],
    after: chunk(fresh, VERSION_INSERT_ROWS).map((part) =>
      db.insert(schema.photoVersions).values(part),
    ),
  };
}
