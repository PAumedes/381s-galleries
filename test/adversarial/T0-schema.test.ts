import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

describe("T0 adversarial: schema", () => {
  beforeAll(async () => {
    await applyD1Migrations(
      env.DB,
      (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
    );
  });

  it("DB rejects invalid galleries.status (enum only enforced in TS)", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title, status) VALUES ('adv1','adv-f1','adv-s1','T','bogus')",
      ).run(),
    ).rejects.toThrow();
  });

  it("DB rejects invalid downloads.variant / kind", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO downloads (id, gallery_id, variant, kind) VALUES ('adv-d1','g','original','weird')",
      ).run(),
    ).rejects.toThrow();
  });

  it("visitors: the same email may repeat per gallery (per-device visitors, PLAN 5.4)", async () => {
    await env.DB.prepare(
      "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('adv2','adv-f2','adv-s2','T')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO visitors (id, gallery_id, email) VALUES ('v-a','adv2','Client@Example.com')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO visitors (id, gallery_id, email) VALUES ('v-b','adv2','client@example.com')",
    ).run();
  });

  it("gallery slugs are unique case-insensitively", async () => {
    await env.DB.prepare(
      "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('adv3','adv-f3','Boda-Ana','T')",
    ).run();
    await expect(
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('adv4','adv-f4','boda-ana','T')",
      ).run(),
    ).rejects.toThrow();
  });

  it("favorites cannot reference a photo from another gallery's visitor", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('adv5','adv-f5','adv-s5','T')",
      ),
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('adv6','adv-f6','adv-s6','T')",
      ),
      env.DB.prepare(
        "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES ('adv-p6','adv6','x','d')",
      ),
      env.DB.prepare(
        "INSERT INTO visitors (id, gallery_id, email) VALUES ('adv-v5','adv5','a@b.c')",
      ),
    ]);
    // IDOR at the data layer: visitor of gallery 5 favoriting a photo of gallery 6.
    await expect(
      env.DB.prepare(
        "INSERT INTO favorites (visitor_id, photo_id) VALUES ('adv-v5','adv-p6')",
      ).run(),
    ).rejects.toThrow();
  });
});
