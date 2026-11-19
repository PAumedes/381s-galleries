import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import {
  listGalleries,
  loadGalleryEdit,
} from "../app/lib/server/admin-galleries";
import { buildOpenData } from "../app/lib/server/gallery";
import { loadHome } from "../app/lib/server/home";

/**
 * Characterization of the cover rule as the four views implement it today:
 * public payload (buildOpenData), admin editor loader, public home query and
 * admin list query. Fixture matrix: mode x photo set x chosen cover x mobile
 * cover. Focal points are always set (desktop 10/20, mobile 30/40).
 */
const e = { ...env, DRIVE_MODE: "mock" } as Env;
const db = getDb(env);

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
});

type Mode = "delivery" | "proofing";
type Name = "p1" | "p2" | "p3" | "foreign" | "none";
/** "mixed": p1 no wm, p2 wm, p3 wm but hidden. "nowm": p1, p2 no wm, p3 hidden. */
type Photos = "mixed" | "nowm";

const GID = "cccccccc-0000-4000-8000-000000000001";
const OTHER = "cccccccc-0000-4000-8000-000000000002";
const pid = (n: Name) =>
  `dddddddd-0000-4000-8000-00000000000${n === "none" ? 0 : n === "foreign" ? 4 : n.slice(1)}`;
const nameOf = (id: string | null | undefined) =>
  id == null
    ? null
    : ((["p1", "p2", "p3", "foreign"] as const).find((n) => pid(n) === id) ??
      id);

async function seed(mode: Mode, photos: Photos, cover: Name, mobile: Name) {
  const base = {
    driveFolderId: "f",
    status: "published" as const,
    showOnHome: true,
    mode,
  };
  await db.insert(schema.galleries).values([
    {
      ...base,
      id: GID,
      slug: "g1",
      title: "G1",
      driveFolderId: "f1",
      coverFocusX: 10,
      coverFocusY: 20,
      coverFocusMobileX: 30,
      coverFocusMobileY: 40,
    },
    {
      ...base,
      id: OTHER,
      slug: "g2",
      title: "G2",
      driveFolderId: "f2",
      showOnHome: false,
    },
  ]);
  const ph = (
    n: Name,
    gid: string,
    sort: number,
    wm: boolean,
    hidden = false,
  ) => ({
    id: pid(n),
    galleryId: gid,
    baseName: `IMG_${n}`,
    driveHighresId: `hr-${n}`,
    driveWmId: wm ? `wm-${n}` : null,
    sort,
    width: 3000,
    height: 2000,
    missingSince: hidden ? "2026-01-01T00:00:00Z" : null,
  });
  await db.insert(schema.photos).values([
    ph("p1", GID, 0, false),
    ph("p2", GID, 1, photos === "mixed"),
    ph("p3", GID, 2, true, true),
    // Created inside G so the cover triggers accept it, moved out below.
    ph("foreign", GID, 3, true),
  ]);
  await db
    .update(schema.galleries)
    .set({
      coverPhotoId: cover === "none" ? null : pid(cover),
      coverPhotoIdMobile: mobile === "none" ? null : pid(mobile),
    })
    .where(eq(schema.galleries.id, GID));
  // Moving a photo out leaves the desktop cover dangling (no trigger clears
  // it); the mobile column is cleared by the DB, so it is not in the matrix.
  await db
    .update(schema.photos)
    .set({ galleryId: OTHER })
    .where(eq(schema.photos.id, pid("foreign")));
}

interface Seen {
  public: {
    cover: string | null;
    focus: unknown;
    mobile: string | null;
    focusMobile: unknown;
  };
  edit: {
    cover: string | null;
    focus: unknown;
    mobile: string | null;
    focusMobile: unknown;
    noWm: boolean;
  };
  home: { cover: string | null; focus: unknown } | null;
  list: string | null;
}

async function views(): Promise<Seen> {
  const [g] = await db
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.id, GID));
  const open = (await buildOpenData(e, g!)).gallery;
  const edit = (await loadGalleryEdit(e, GID))!.gallery;
  const home = (await loadHome(e)).items.find((i) => i.slug === "g1");
  const list = (await listGalleries(e, "all")).find((r) => r.id === GID)!;
  return {
    public: {
      cover: nameOf(open.coverPhotoId),
      focus: open.coverFocus,
      mobile: nameOf(open.coverPhotoIdMobile),
      focusMobile: open.coverFocusMobile,
    },
    edit: {
      cover: nameOf(edit.coverPhotoId),
      focus: edit.coverFocus,
      mobile: nameOf(edit.coverPhotoIdMobile),
      focusMobile: edit.coverFocusMobile,
      noWm: "mobileCoverNoWm" in edit,
    },
    home: home
      ? { cover: nameOf(home.cover.id), focus: home.cover.focus }
      : null,
    list: nameOf(list.coverPhotoId),
  };
}

const F = { x: 10, y: 20 };
const FM = { x: 30, y: 40 };

const MODES: Mode[] = ["delivery", "proofing"];
const PHOTO_SETS: Photos[] = ["mixed", "nowm"];
const COVERS: Name[] = ["none", "p1", "p2", "p3", "foreign"];
const MOBILES: Name[] = ["none", "p1", "p2", "p3"];

/**
 * Desktop cover per view as of today: [public payload, edit loader, home,
 * admin list]. Independent of the mobile cover (asserted by the product loop).
 * null in "home" = the gallery is not on the home at all.
 */
const COVER_TABLE: [
  Mode,
  Photos,
  Name,
  [string | null, string | null, string | null, string | null],
][] = [
  ["delivery", "mixed", "foreign", ["p1", null, "p1", "p1"]],
  ["delivery", "mixed", "none", ["p1", null, "p1", "p1"]],
  ["delivery", "mixed", "p1", ["p1", "p1", "p1", "p1"]],
  ["delivery", "mixed", "p2", ["p2", "p2", "p2", "p2"]],
  ["delivery", "mixed", "p3", ["p1", null, "p1", "p1"]],
  ["delivery", "nowm", "foreign", ["p1", null, "p1", "p1"]],
  ["delivery", "nowm", "none", ["p1", null, "p1", "p1"]],
  ["delivery", "nowm", "p1", ["p1", "p1", "p1", "p1"]],
  ["delivery", "nowm", "p2", ["p2", "p2", "p2", "p2"]],
  ["delivery", "nowm", "p3", ["p1", null, "p1", "p1"]],
  ["proofing", "mixed", "foreign", ["p2", "p2", "p2", "p2"]],
  ["proofing", "mixed", "none", ["p2", "p2", "p2", "p2"]],
  ["proofing", "mixed", "p1", ["p2", "p2", "p2", "p2"]],
  ["proofing", "mixed", "p2", ["p2", "p2", "p2", "p2"]],
  ["proofing", "mixed", "p3", ["p2", "p2", "p2", "p2"]],
  ["proofing", "nowm", "foreign", [null, null, null, null]],
  ["proofing", "nowm", "none", [null, null, null, null]],
  ["proofing", "nowm", "p1", [null, "p1", null, null]],
  ["proofing", "nowm", "p2", [null, "p2", null, null]],
  ["proofing", "nowm", "p3", [null, null, null, null]],
];
/** Mobile cover per view: [public payload, edit loader, edit "mobileCoverNoWm" flag]. */
const MOBILE_TABLE: [
  Mode,
  Photos,
  Name,
  [string | null, string | null, boolean],
][] = [
  ["delivery", "mixed", "none", [null, null, false]],
  ["delivery", "mixed", "p1", ["p1", "p1", false]],
  ["delivery", "mixed", "p2", ["p2", "p2", false]],
  ["delivery", "mixed", "p3", [null, null, false]],
  ["delivery", "nowm", "none", [null, null, false]],
  ["delivery", "nowm", "p1", ["p1", "p1", false]],
  ["delivery", "nowm", "p2", ["p2", "p2", false]],
  ["delivery", "nowm", "p3", [null, null, false]],
  ["proofing", "mixed", "none", [null, null, false]],
  ["proofing", "mixed", "p1", [null, null, true]],
  ["proofing", "mixed", "p2", ["p2", "p2", false]],
  ["proofing", "mixed", "p3", [null, null, false]],
  ["proofing", "nowm", "none", [null, null, false]],
  ["proofing", "nowm", "p1", [null, null, true]],
  ["proofing", "nowm", "p2", [null, null, true]],
  ["proofing", "nowm", "p3", [null, null, false]],
];
const lookup = <T>(t: [Mode, Photos, Name, T][], m: Mode, p: Photos, n: Name) =>
  t.find((r) => r[0] === m && r[1] === p && r[2] === n)![3];

describe("cover rule: four views on one fixture matrix (characterization)", () => {
  for (const mode of MODES)
    for (const photos of PHOTO_SETS)
      for (const cover of COVERS)
        for (const mobile of MOBILES)
          it(`${mode} / ${photos} / cover=${cover} / mobile=${mobile}`, async () => {
            await seed(mode, photos, cover, mobile);
            const v = await views();
            const [pub, edit, home, list] = lookup(
              COVER_TABLE,
              mode,
              photos,
              cover,
            );
            const [mPub, mEdit, noWm] = lookup(
              MOBILE_TABLE,
              mode,
              photos,
              mobile,
            );
            expect([
              v.public.cover,
              v.edit.cover,
              v.home?.cover ?? null,
              v.list,
            ]).toEqual([pub, edit, home, list]);
            expect([v.public.mobile, v.edit.mobile, v.edit.noWm]).toEqual([
              mPub,
              mEdit,
              noWm,
            ]);
            // Focal points: desktop always passes through; the mobile one
            // only travels with a mobile cover that is actually served.
            expect(v.public.focus).toEqual(F);
            expect(v.edit.focus).toEqual(F);
            if (v.home) expect(v.home.focus).toEqual(F);
            expect(v.public.focusMobile).toEqual(mPub ? FM : null);
            expect(v.edit.focusMobile).toEqual(mEdit ? FM : null);
          });
});

/**
 * Where the views DISAGREE today. Each test documents CURRENT behaviour, not
 * the desired one (see the commit/PR notes for the recommendation).
 */
describe("cover rule: known disagreements (current behaviour)", () => {
  it("D1 admin list now follows the public rule in proofing: p2 (first preview-wm), like the public page and home", async () => {
    await seed("proofing", "mixed", "p1", "none");
    const v = await views();
    expect(v.public.cover).toBe("p2");
    expect(v.home?.cover).toBe("p2");
    expect(v.list).toBe("p2");
  });

  it("D2 (fixed) proofing with no preview-wm at all: public page names no cover (it would 404), home and list name none", async () => {
    await seed("proofing", "nowm", "p1", "none");
    const v = await views();
    expect(v.public.cover).toBeNull();
    expect(v.home).toBeNull();
    expect(v.list).toBeNull();
  });

  it("D3 edit loader reports only the CHOSEN cover (null when none/hidden/foreign) where public, home and list fall back to the first photo", async () => {
    for (const cover of ["none", "p3", "foreign"] as Name[]) {
      await db.delete(schema.galleries);
      await seed("delivery", "mixed", cover, "none");
      const v = await views();
      expect(v.edit.cover).toBeNull();
      expect([v.public.cover, v.home?.cover, v.list]).toEqual([
        "p1",
        "p1",
        "p1",
      ]);
    }
  });

  it("D4 edit loader in proofing does fall back to the first preview-wm photo (agrees with public, unlike D3)", async () => {
    await seed("proofing", "mixed", "none", "none");
    const v = await views();
    expect([v.public.cover, v.edit.cover, v.home?.cover]).toEqual([
      "p2",
      "p2",
      "p2",
    ]);
  });
});
