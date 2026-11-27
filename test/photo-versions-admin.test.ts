import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "../app/db";
import { VERSIONED_APPROVALS_D1_QUERIES } from "../app/lib/server/d1-limits";
import { loadGalleryEdit } from "../app/lib/server/admin-galleries";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv, noRatePrune } from "./support/warm";
import { seedVersioned } from "./support/versions";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000f1";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables("photo_versions", "delivery_rounds", "photos", "galleries");
  noRatePrune();
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "retoque",
    title: "Retoque",
    status: "published",
    versioning: true,
    mode: "proofing",
  });
  return () => vi.restoreAllMocks();
});

const warning = async (e: Env = env) =>
  (await loadGalleryEdit(e, G))!.issues.groups.find(
    (g) => g.type === "version_wm_fallback",
  );

describe("T6.53c admin: Prueba falls back to an earlier version (count warning, never blocking)", () => {
  it("lists the photos whose latest version has no preview-wm but an earlier one has", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2, wm: false }]);
    await seedVersioned(G, "B", [{ n: 1 }, { n: 2 }], { sort: 1 });
    await seedVersioned(
      G,
      "C",
      [
        { n: 1, wm: false },
        { n: 2, wm: false },
      ],
      {
        sort: 2,
      },
    );
    const data = (await loadGalleryEdit(env, G))!;
    const w = data.issues.groups.find((g) => g.type === "version_wm_fallback");
    expect(w?.items.map((i) => i.name)).toEqual(["A"]);
    expect(w?.label).toBe(
      "Última versión sin preview-wm: se muestra una versión anterior",
    );
    // C has no preview-wm in any version: the existing "missing_wm" group, not this one.
    expect(
      data.issues.groups
        .find((g) => g.type === "missing_wm")
        ?.items.map((i) => i.name),
    ).toContain("C");
    expect(data.photoCount).toBe(3);
  });

  it("ignores a latest version that left Drive", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2, wm: false, missing: true }]);
    expect(await warning()).toBeUndefined();
  });

  it("no warning in Entrega or in an album with versioning off, and no extra D1 query", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2, wm: false }]);
    await db.update(schema.galleries).set({ mode: "delivery" });
    expect(await warning()).toBeUndefined();
    await db
      .update(schema.galleries)
      .set({ mode: "proofing", versioning: false });
    const off = countingEnv(env);
    expect(await warning(off.e)).toBeUndefined();
    await db.update(schema.galleries).set({ versioning: true });
    const on = countingEnv(env);
    expect(await warning(on.e)).toBeDefined();
    // The version rows (T6.53c) plus the approvals summary (T6.53f), both versioned-only.
    expect(on.count() - off.count()).toBe(1 + VERSIONED_APPROVALS_D1_QUERIES);
  });
});
