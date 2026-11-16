import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

describe("T0r2 adversarial: schema", () => {
  beforeAll(async () => {
    await applyD1Migrations(
      env.DB,
      (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
    );
    for (const n of ["a", "b"]) {
      await env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES (?,?,?,'T')",
      ).bind(`r2g-${n}`, `r2f-${n}`, `r2s-${n}`).run();
    }
    await env.DB.prepare(
      "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES ('r2p-b','r2g-b','x','d')",
    ).run();
  });

  it("galleries.cover_photo_id cannot reference a photo of another gallery", async () => {
    await expect(
      env.DB.prepare(
        "UPDATE galleries SET cover_photo_id='r2p-b' WHERE id='r2g-a'",
      ).run(),
    ).rejects.toThrow();
  });

  it("boolean flags are constrained to 0/1", async () => {
    await expect(
      env.DB.prepare(
        "UPDATE galleries SET allow_highres=7 WHERE id='r2g-a'",
      ).run(),
    ).rejects.toThrow();
  });

  it("empty slug is rejected", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('r2g-c','r2f-c','','T')",
      ).run(),
    ).rejects.toThrow();
  });
});
