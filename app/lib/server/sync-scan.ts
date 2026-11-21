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

type ListMany = (ids: string[]) => Promise<Map<string, DriveFile[]>>;

/** One level of the breadth-first walk: listChildrenMany within the budget (40 ids per call). */
const listLevel =
  (drive: DriveClient, guard: Guard): ListMany =>
  async (ids) => {
    if (ids.length === 0) return new Map<string, DriveFile[]>();
    guard.reserve(Math.ceil(ids.length / 40));
    const r = await drive.listChildrenMany(ids);
    guard.check();
    return r;
  };

/** Level 0/1: root -> album folders. Verify the root first: an unknown id would otherwise list as empty and archive every gallery. */
async function listAlbums(
  rootId: string,
  drive: DriveClient,
  guard: Guard,
  many: ListMany,
): Promise<DriveFile[]> {
  guard.reserve(1);
  const meta = await drive.getMeta(rootId);
  guard.check();
  if (!isFolder(meta) || meta.trashed)
    throw new DriveError(400, "Root is not a usable folder");
  return ((await many([rootId])).get(rootId) ?? [])
    .filter((f) => isFolder(f) && isLive(f))
    .sort((a, b) => cmp(nfc(a.name), nfc(b.name)) || cmp(a.id, b.id));
}

type RecipeFolder = { album: string; recipe: Recipe; id: string };
type SetFolder = RecipeFolder & { set: string };

/** What the walk learns per album id. */
type ScanState = {
  located: Map<string, Located[]>;
  issues: Map<string, SyncIssue[]>;
  hasWm: Map<string, boolean>;
};

/** Level 2: album children -> recipe folders; stray files and unknown folders become issues. */
function classifyAlbumChildren(
  albums: DriveFile[],
  kids: Map<string, DriveFile[]>,
  state: ScanState,
): RecipeFolder[] {
  const recipeFolders: RecipeFolder[] = [];
  for (const a of albums) {
    const list: SyncIssue[] = [];
    state.issues.set(a.id, list);
    for (const c of kids.get(a.id) ?? []) {
      if (!isLive(c)) continue;
      if (isFolder(c)) {
        const r = recipeOf(c.name);
        if (r) {
          recipeFolders.push({ album: a.id, recipe: r, id: c.id });
          if (r === "preview-wm") state.hasWm.set(a.id, true);
        } else list.push({ type: "unknown_folder", set: null, name: c.name });
      } else list.push({ type: "stray_file", set: null, name: c.name });
    }
  }
  return recipeFolders;
}

/** Level 3: recipe folders -> files (default set) + set subfolders. */
function collectRecipeFiles(
  recipeFolders: RecipeFolder[],
  kids: Map<string, DriveFile[]>,
  state: ScanState,
): SetFolder[] {
  const setFolders: SetFolder[] = [];
  for (const rf of recipeFolders) {
    const out = state.located.get(rf.album) ?? [];
    state.located.set(rf.album, out);
    for (const c of kids.get(rf.id) ?? []) {
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
  return setFolders;
}

/** Level 4: set folders -> files; deeper folders are issues. */
function collectSetFiles(
  setFolders: SetFolder[],
  kids: Map<string, DriveFile[]>,
  state: ScanState,
): void {
  for (const sf of setFolders) {
    const out = state.located.get(sf.album) ?? [];
    state.located.set(sf.album, out);
    for (const c of kids.get(sf.id) ?? []) {
      if (!isLive(c)) continue;
      if (isFolder(c))
        state.issues
          .get(sf.album)!
          .push({ type: "unknown_folder", set: sf.set, name: c.name });
      else out.push({ recipe: sf.recipe, set: sf.set, file: c });
    }
  }
}

export async function scan(
  rootId: string,
  drive: DriveClient,
  guard: Guard,
): Promise<AlbumDraft[]> {
  const many = listLevel(drive, guard);
  const state: ScanState = {
    located: new Map(),
    issues: new Map(),
    hasWm: new Map(),
  };
  const albums = await listAlbums(rootId, drive, guard, many);
  const recipeFolders = classifyAlbumChildren(
    albums,
    await many(albums.map((a) => a.id)),
    state,
  );
  const setFolders = collectRecipeFiles(
    recipeFolders,
    await many(recipeFolders.map((r) => r.id)),
    state,
  );
  collectSetFiles(setFolders, await many(setFolders.map((s) => s.id)), state);

  return albums.map((a) =>
    buildAlbum(
      a,
      state.located.get(a.id) ?? [],
      state.issues.get(a.id) ?? [],
      state.hasWm.get(a.id) === true,
    ),
  );
}
