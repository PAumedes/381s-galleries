import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import type { DriveClient } from "../../app/lib/server/drive-types";
import { serveImage } from "../../app/lib/server/images";

const G = "aaaaaaaa-0000-0000-0000-0000000000b1";
const P = "pppppppp-0000-0000-0000-0000000000b1";
const e = { ...env, DRIVE_MODE: "google" } as Env;
beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
async function get(d: DriveClient) {
  const pending: Promise<unknown>[] = [];
  const res = await serveImage(
    new Request(`https://x.test/img/${P}/view-sm`),
    { photoId: P, variant: "view-sm" },
    e,
    { waitUntil: (p: Promise<unknown>) => void pending.push(p) },
    { drive: d },
  );
  const text = await res.text();
  await Promise.allSettled(pending);
  return text;
}
const mk = (s: string) =>
  ({
    async streamFile() {
      return new Response(s, {
        headers: { "Content-Length": String(s.length) },
      });
    },
  }) as unknown as DriveClient;

describe("T2.3r2 same Drive id, new content (in-place re-export)", () => {
  it("serves the new bytes after the Drive file is overwritten in place", async () => {
    const db = getDb(env);
    for (const o of (await env.CACHE.list()).objects)
      await env.CACHE.delete(o.key);
    await db.delete(schema.galleries);
    await db.insert(schema.galleries).values({
      id: G,
      driveFolderId: "f",
      slug: "s2",
      title: "T",
      status: "published",
    });
    await db.insert(schema.photos).values({
      id: P,
      galleryId: G,
      baseName: "p",
      driveHighresId: "HI",
      driveWebId: "WEB",
      width: 3,
      height: 2,
    });
    expect(await get(mk("OLD-BYTES"))).toBe("OLD-BYTES");
    // Same fileId, Drive content replaced (Drive keeps the id on content update)
    expect(await get(mk("NEW-BYTES"))).toBe("NEW-BYTES");
  });
});
