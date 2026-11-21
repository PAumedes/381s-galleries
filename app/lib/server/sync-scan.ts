/**
 * Drive scan for the sync engine (PLAN §5.1): breadth-first with
 * listChildrenMany (root -> albums -> recipe folders -> set folders), so a
 * whole library costs a handful of subrequests. Read-only; builds the desired
 * state in memory and never writes. Every list call is checked against the
 * run's subrequest budget.
 */
import {
  buildAlbum,
  cmp,
  DEFAULT_SET,
  isFolder,
  isLive,
  nfc,
  recipeOf,
} from "./sync-helpers";
import type { AlbumDraft, Located, Recipe, SyncIssue } from "./sync-helpers";
import { DriveError } from "./drive-types";
import type { DriveClient, DriveFile } from "./drive-types";

export class SyncBudgetError extends Error {
  constructor() {
    super("Sync subrequest budget exceeded");
    this.name = "SyncBudgetError";
  }
}

/** Tracks external (Drive + OAuth) subrequests against the run's budget. */
export interface Guard {
  /** Throws unless `n` more external calls still fit in the budget. */
  reserve(n: number): void;
  /** Throws if the calls already made exceed the budget (retries etc). */
  check(): void;
}

export function makeGuard(drive: DriveClient, budget: number): Guard {
  const start = drive.subrequests();
  const used = () => drive.subrequests() - start;
  return {
    reserve(n) {
      if (used() + n > budget) throw new SyncBudgetError();
    },
    check() {
      if (used() > budget) throw new SyncBudgetError();
    },
  };
}

export async function scan(
  rootId: string,
  drive: DriveClient,
  guard: Guard,
): Promise<AlbumDraft[]> {
  const many = async (ids: string[]) => {
    if (ids.length === 0) return new Map<string, DriveFile[]>();
    guard.reserve(Math.ceil(ids.length / 40));
    const r = await drive.listChildrenMany(ids);
    guard.check();
    return r;
  };

  // Level 0/1: root -> album folders. Verify the root first: an unknown id
  // would otherwise list as empty and archive every gallery.
  guard.reserve(1);
  const meta = await drive.getMeta(rootId);
  guard.check();
  if (!isFolder(meta) || meta.trashed)
    throw new DriveError(400, "Root is not a usable folder");
  const albums = ((await many([rootId])).get(rootId) ?? [])
    .filter((f) => isFolder(f) && isLive(f))
    .sort((a, b) => cmp(nfc(a.name), nfc(b.name)) || cmp(a.id, b.id));

  // Level 2: album children.
  const albumKids = await many(albums.map((a) => a.id));
  const recipeFolders: { album: string; recipe: Recipe; id: string }[] = [];
  const issues = new Map<string, SyncIssue[]>();
  const hasWm = new Map<string, boolean>();
  for (const a of albums) {
    const list: SyncIssue[] = [];
    issues.set(a.id, list);
    for (const c of albumKids.get(a.id) ?? []) {
      if (!isLive(c)) continue;
      if (isFolder(c)) {
        const r = recipeOf(c.name);
        if (r) {
          recipeFolders.push({ album: a.id, recipe: r, id: c.id });
          if (r === "preview-wm") hasWm.set(a.id, true);
        } else list.push({ type: "unknown_folder", set: null, name: c.name });
      } else list.push({ type: "stray_file", set: null, name: c.name });
    }
  }

  // Level 3: recipe folders -> files + set subfolders.
  const recipeKids = await many(recipeFolders.map((r) => r.id));
  const located = new Map<string, Located[]>();
  const setFolders: {
    album: string;
    recipe: Recipe;
    set: string;
    id: string;
  }[] = [];
  for (const rf of recipeFolders) {
    const out = located.get(rf.album) ?? [];
    located.set(rf.album, out);
    for (const c of recipeKids.get(rf.id) ?? []) {
      if (!isLive(c)) continue;
      if (isFolder(c))
        setFolders.push({
          album: rf.album,
          recipe: rf.recipe,
          set: nfc(c.name) || DEFAULT_SET,
          id: c.id,
        });
      else out.push({ recipe: rf.recipe, set: DEFAULT_SET, file: c });
    }
  }

  // Level 4: set folders -> files.
  const setKids = await many(setFolders.map((s) => s.id));
  for (const sf of setFolders) {
    const out = located.get(sf.album) ?? [];
    located.set(sf.album, out);
    for (const c of setKids.get(sf.id) ?? []) {
      if (!isLive(c)) continue;
      if (isFolder(c))
        issues
          .get(sf.album)!
          .push({ type: "unknown_folder", set: sf.set, name: c.name });
      else out.push({ recipe: sf.recipe, set: sf.set, file: c });
    }
  }

  return albums.map((a) =>
    buildAlbum(
      a,
      located.get(a.id) ?? [],
      issues.get(a.id) ?? [],
      hasWm.get(a.id) === true,
    ),
  );
}
