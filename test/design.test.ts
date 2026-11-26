import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import {
  COVER_LAYOUTS,
  GAP_PX,
  GRID_GAPS,
  GRID_STYLES,
  PALETTES,
  isDarkPalette,
} from "../app/lib/design";
import {
  galleryAction,
  loadGalleryEdit,
} from "../app/lib/server/admin-galleries";
import { loadGallery } from "../app/lib/server/gallery";
import { hashPin } from "../app/lib/server/crypto";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const G = "dddddddd-0000-0000-0000-0000000000d1";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "folder-d",
    slug: "diseno",
    title: "Diseno",
    status: "published",
  });
});

const act = (fields: Record<string, string>) =>
  galleryAction(
    new Request(`http://localhost/admin/g/${G}`, {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
    e,
    G,
  );
const row = async () =>
  (
    await db.select().from(schema.galleries).where(eq(schema.galleries.id, G))
  )[0];
const getReq = () => new Request("https://session.test/diseno");

describe("design enums", () => {
  it("lists exactly the owner's options", () => {
    expect(PALETTES).toEqual(["claro", "oscuro", "arena", "gris"]);
    expect(COVER_LAYOUTS).toEqual([
      "completa",
      "dividida",
      "centrada",
      "minima",
    ]);
    expect(GRID_STYLES).toEqual(["filas", "cuadricula", "columnas"]);
    expect(GRID_GAPS).toEqual(["compacto", "normal", "amplio"]);
    expect(GAP_PX).toEqual({ compacto: 2, normal: 6, amplio: 16 });
    expect(PALETTES.filter(isDarkPalette)).toEqual(["oscuro"]);
  });
});

describe("migration 0015_design", () => {
  it("defaults: claro / completa / filas / normal", async () => {
    const r = await row();
    expect([r.palette, r.coverLayout, r.gridStyle, r.gridGap]).toEqual([
      "claro",
      "completa",
      "filas",
      "normal",
    ]);
  });
  it("maps legacy theme: light -> claro, dark -> oscuro (the migration's UPDATE)", async () => {
    const mig = (
      env as unknown as {
        TEST_MIGRATIONS: { name: string; queries: string[] }[];
      }
    ).TEST_MIGRATIONS.find((m) => m.name.startsWith("0015"));
    expect(mig?.name).toBe("0015_design.sql");
    const update = mig!.queries.find((q) => /UPDATE\s+`?galleries`?/i.test(q))!;
    expect(update).toBeTruthy();
    await db.insert(schema.galleries).values([
      {
        id: "d-light",
        driveFolderId: "f1",
        slug: "l",
        title: "L",
        theme: "light",
      },
      {
        id: "d-dark",
        driveFolderId: "f2",
        slug: "d",
        title: "D",
        theme: "dark",
      },
    ]);
    await env.DB.prepare("UPDATE galleries SET palette = 'gris'").run();
    await env.DB.prepare(update).run();
    const p = async (id: string) =>
      (
        await db
          .select()
          .from(schema.galleries)
          .where(eq(schema.galleries.id, id))
      )[0].palette;
    expect(await p("d-light")).toBe("claro");
    expect(await p("d-dark")).toBe("oscuro");
  });
  it("the DB itself rejects values outside the enums (CHECK)", async () => {
    for (const col of ["palette", "cover_layout", "grid_style", "grid_gap"])
      await expect(
        env.DB.prepare(`UPDATE galleries SET ${col} = 'neon'`).run(),
      ).rejects.toThrow();
  });
});

describe("intent design", () => {
  const ok = {
    intent: "design",
    palette: "arena",
    coverLayout: "dividida",
    gridStyle: "columnas",
    gridGap: "amplio",
  };
  it("saves the four values", async () => {
    const r = await act(ok);
    expect(r.ok).toBe(true);
    const g = await row();
    expect([g.palette, g.coverLayout, g.gridStyle, g.gridGap]).toEqual([
      "arena",
      "dividida",
      "columnas",
      "amplio",
    ]);
  });
  it("accepts every option of every enum", async () => {
    for (const p of PALETTES)
      expect((await act({ ...ok, palette: p })).ok).toBe(true);
    for (const p of COVER_LAYOUTS)
      expect((await act({ ...ok, coverLayout: p })).ok).toBe(true);
    for (const p of GRID_STYLES)
      expect((await act({ ...ok, gridStyle: p })).ok).toBe(true);
    for (const p of GRID_GAPS)
      expect((await act({ ...ok, gridGap: p })).ok).toBe(true);
  });
  it.each([
    ["palette", "neon"],
    ["palette", "light"],
    ["palette", "ARENA"],
    ["palette", ""],
    ["coverLayout", "full"],
    ["gridStyle", "masonry"],
    ["gridGap", "10"],
  ])("rejects %s=%j, stores nothing", async (field, value) => {
    await act({ ...ok, palette: "gris" });
    const r = await act({ ...ok, [field]: value });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.[field]).toBeTruthy();
    const g = await row();
    expect([g.palette, g.coverLayout, g.gridStyle, g.gridGap]).toEqual([
      "gris",
      "dividida",
      "columnas",
      "amplio",
    ]);
  });
  it("absent keys keep the stored value", async () => {
    await act(ok);
    expect((await act({ intent: "design", gridGap: "compacto" })).ok).toBe(
      true,
    );
    const g = await row();
    expect([g.palette, g.coverLayout, g.gridStyle, g.gridGap]).toEqual([
      "arena",
      "dividida",
      "columnas",
      "compacto",
    ]);
  });
  it("the flags intent no longer touches or validates the palette", async () => {
    await act(ok);
    const r = await act({
      intent: "flags",
      mode: "delivery",
      theme: "neon",
      palette: "gris",
    });
    expect(r.ok).toBe(true);
    expect((await row()).palette).toBe("arena");
  });
});

describe("payloads", () => {
  it("public open payload carries the four values (and no `theme`)", async () => {
    await act({
      intent: "design",
      palette: "gris",
      coverLayout: "centrada",
      gridStyle: "cuadricula",
      gridGap: "compacto",
    });
    const r = await loadGallery(getReq(), "diseno", env);
    expect(r.data.state).toBe("open");
    if (r.data.state !== "open") return;
    expect(r.data.gallery).toMatchObject({
      palette: "gris",
      coverLayout: "centrada",
      gridStyle: "cuadricula",
      gridGap: "compacto",
    });
    expect("theme" in r.data.gallery).toBe(false);
  });
  it("locked (PIN) payload follows the palette", async () => {
    await db
      .update(schema.galleries)
      .set({ pinHash: await hashPin("1234"), palette: "arena" });
    const r = await loadGallery(getReq(), "diseno", env);
    expect(r.data).toEqual({
      state: "locked",
      slug: "diseno",
      title: "Diseno",
      palette: "arena",
      step: "album",
    });
  });
  it("admin editor payload carries the four values", async () => {
    await act({
      intent: "design",
      palette: "oscuro",
      coverLayout: "minima",
      gridStyle: "filas",
      gridGap: "amplio",
    });
    const g = (await loadGalleryEdit(env, G))!.gallery;
    expect([g.palette, g.coverLayout, g.gridStyle, g.gridGap]).toEqual([
      "oscuro",
      "minima",
      "filas",
      "amplio",
    ]);
  });
});
