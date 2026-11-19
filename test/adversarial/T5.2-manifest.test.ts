import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { hashPin } from "../../app/lib/server/crypto";
import { handleManifest } from "../../app/lib/server/manifest";
import { loadGallery } from "../../app/lib/server/gallery";
import { pwaMeta, shortName } from "../../app/lib/pwa";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000b2";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM photos"),
    env.DB.prepare("DELETE FROM galleries"),
  ]);
});

async function add(over: Partial<typeof schema.galleries.$inferInsert> = {}) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "boda",
    title: "Boda Secreta de Ana",
    status: "published",
    ...over,
  });
}
const get = async (slug: string) =>
  (await handleManifest(
    new Request(`https://s.test/api/g/${slug}/manifest.webmanifest`),
    slug,
    env,
  ).then((r) => r.json())) as Record<string, string>;

describe("T5.2 PIN gallery manifest (orchestrator decision)", () => {
  it("PIN gallery: generic name/icons but start_url /<slug>/?source=pwa and id /<slug>", async () => {
    await add({ pinHash: await hashPin("1234") });
    const m = await get("boda");
    expect(m.name).toBe("381 Studios");
    expect(JSON.stringify(m)).not.toContain("Secreta");
    expect(m.start_url).toBe("/boda/?source=pwa");
    expect(m.id).toBe("/boda");
  });

  it("the locked page links the slug-specific manifest, else installs use the generic one", async () => {
    await add({ pinHash: await hashPin("1234") });
    const { data } = await loadGallery(
      new Request("https://s.test/boda"),
      "boda",
      env,
    );
    expect(data.state).toBe("locked");
    const tags = pwaMeta(data, { studio: "381 Studios" });
    expect(JSON.stringify(tags)).toContain("/api/g/boda/manifest.webmanifest");
  });

  it("draft/expired/unknown stay generic with start_url /", async () => {
    await add({ status: "draft" });
    expect((await get("boda")).start_url).toBe("/");
    expect((await get("nope")).start_url).toBe("/");
  });
});

describe("T5.2 scope", () => {
  it("scope must not also cover a sibling gallery /<slug>-2, and start_url must be inside scope", async () => {
    await add();
    const m = await get("boda");
    const inScope = (p: string) =>
      new URL(p, "https://s.test").href.startsWith(
        new URL(m.scope, "https://s.test").href,
      );
    expect(inScope("/boda-2")).toBe(false);
    expect(inScope(m.start_url)).toBe(true);
  });
});

describe("T5.2 short_name", () => {
  it("does not split a grapheme cluster (flag emoji)", () => {
    const s = shortName("a".repeat(11) + "🇦🇷");
    const seg = [...new Intl.Segmenter().segment(s)].map((x) => x.segment);
    expect(seg.every((g) => !/^[\u{1F1E6}-\u{1F1FF}]$/u.test(g))).toBe(true);
  });
  it("does not leave a dangling ZWJ / strip a combining accent", () => {
    const s = shortName("a".repeat(11) + "é");
    expect(s).not.toBe("a".repeat(11) + "e");
  });
});
