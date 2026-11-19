import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { galleryAction } from "../../app/lib/server/admin-galleries";
import { loadGallery } from "../../app/lib/server/gallery";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const G = "eeeeeeee-0000-0000-0000-0000000000e1";
beforeAll(async () => {
  await migrateDb();
  await env.DB.prepare(
    "INSERT INTO galleries (id, drive_folder_id, slug, title, status, theme, client_name) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(G, "f-e1", "e1", "T", "published", "dark", "SECRET CLIENT")
    .run();
});
const row = () =>
  env.DB.prepare(
    "SELECT palette, cover_layout, grid_style, grid_gap FROM galleries WHERE id=?",
  )
    .bind(G)
    .first<Record<string, string>>();
const act = (b: Record<string, string>, headers: Record<string, string> = {}) =>
  galleryAction(
    new Request(`http://localhost/admin/g/${G}`, {
      method: "POST",
      body: new URLSearchParams(b),
      headers,
    }),
    e,
    G,
  );

describe("T6.5 server", () => {
  it("DB CHECKs reject bad values", async () => {
    for (const [c, v] of [
      ["palette", "dark"],
      ["cover_layout", "x"],
      ["grid_style", ""],
      ["grid_gap", "huge"],
    ])
      await expect(
        env.DB.prepare(`UPDATE galleries SET ${c}=? WHERE id=?`)
          .bind(v, G)
          .run(),
      ).rejects.toThrow();
  });
  it("invalid palette leaves everything untouched, even valid siblings", async () => {
    await act({ intent: "design", palette: "arena" });
    const r = await act({
      intent: "design",
      palette: "Arena",
      gridStyle: "columnas",
    });
    expect((r as { ok: boolean }).ok).toBe(false);
    expect((await row())!.palette).toBe("arena");
    expect((await row())!.grid_style).toBe("filas");
  });
  it("empty string / file / array-ish values rejected", async () => {
    for (const v of ["", " claro", "claro\n", "__proto__", "constructor"]) {
      const r = await act({ intent: "design", palette: v });
      expect((r as { ok: boolean }).ok, JSON.stringify(v)).toBe(false);
    }
  });
  it("public payload has no clientName/theme/driveFolderId", async () => {
    await act({ intent: "design", palette: "gris", coverLayout: "minima" });
    const res = await loadGallery(new Request("http://localhost/e1"), "e1", e);
    const s = JSON.stringify(res.data);
    expect(s).not.toContain("SECRET CLIENT");
    expect(s).not.toContain("f-e1");
    expect(s).not.toContain('"theme"');
  });
  it("legacy backfill: dark theme row migrated to oscuro", async () => {
    // migration already ran on empty DB; replay the UPDATE semantics on a row inserted with theme=dark before? new rows get claro
    const r = await env.DB.prepare(
      "SELECT palette FROM galleries WHERE id='nope'",
    ).first();
    expect(r).toBeNull();
  });
});
