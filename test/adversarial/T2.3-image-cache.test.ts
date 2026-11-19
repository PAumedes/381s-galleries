import { clearCache } from "../support/cache";
import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import type { DriveClient } from "../../app/lib/server/drive-types";
import { serveImage } from "../../app/lib/server/images";

const db = getDb(env);
const G = "aaaaaaaa-0000-0000-0000-0000000000a1";
const P = "pppppppp-0000-0000-0000-0000000000a1";
const e = { ...env, DRIVE_MODE: "google" } as Env;

beforeAll(async () => {
  await migrateDb();
});

// body is keyed by drive id so tests can tell which file was served
function drive(
  bodies: Record<string, Uint8Array>,
  make?: (id: string) => Response,
) {
  return {
    async streamFile(id: string) {
      if (make) return make(id);
      const b = bodies[id];
      return new Response(b.slice(), {
        headers: { "Content-Length": String(b.length) },
      });
    },
  } as unknown as DriveClient;
}
async function get(variant: string, d: DriveClient) {
  const pending: Promise<unknown>[] = [];
  const res = await serveImage(
    new Request(`https://x.test/img/${P}/${variant}`),
    { photoId: P, variant },
    e,
    { waitUntil: (p: Promise<unknown>) => void pending.push(p) },
    { drive: d },
  );
  let text: string;
  try {
    text = await res.text();
  } catch {
    text = "<<error>>";
  }
  await Promise.allSettled(pending);
  return { res, text };
}
const enc = (s: string) => new TextEncoder().encode(s);

beforeEach(async () => {
  await db.delete(schema.galleries);
  await clearCache();
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "s",
    title: "T",
    status: "published",
    mode: "delivery",
  });
  await db.insert(schema.photos).values({
    id: P,
    galleryId: G,
    baseName: "p",
    driveHighresId: "HI",
    driveWebId: "WEB",
    driveWmId: "WM",
    width: 3,
    height: 2,
  });
});

const files = {
  HI: enc("CLEAN-HI"),
  WEB: enc("CLEAN-WEB"),
  WM: enc("WATERMARKED"),
  HI2: enc("NEW-HI"),
};

describe("T2.3 cache vs state changes", () => {
  it("turning watermark ON must not serve previously cached clean view-sm", async () => {
    await get("view-sm", drive(files));
    await db.update(schema.galleries).set({ mode: "proofing" });
    const { text } = await get("view-sm", drive(files));
    expect(text).toBe("WATERMARKED");
  });
  it("turning watermark OFF must not keep serving the watermarked view-sm", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    await get("view-sm", drive(files));
    await db.update(schema.galleries).set({ mode: "delivery" });
    const { text } = await get("view-sm", drive(files));
    expect(text).toBe("CLEAN-WEB");
  });
  it("re-exported file (new drive id) must not serve stale cache", async () => {
    await get("view-lg", drive(files));
    await db.update(schema.photos).set({ driveHighresId: "HI2" });
    const { text } = await get("view-lg", drive(files));
    expect(text).toBe("NEW-HI");
  });
});

describe("T2.3 watermark thumb fallback", () => {
  it("watermark on and no thumb file: thumb must not serve clean web/high-res", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    const { res, text } = await get("thumb", drive(files));
    expect(text).not.toBe("CLEAN-WEB");
    expect(text).not.toBe("CLEAN-HI");
    // Intent: never leak a clean image. Serving the watermarked file as the
    // thumbnail is acceptable (orchestrator decision); 404 is too.
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) expect(text).toBe("WATERMARKED");
  });
});

describe("T2.3 partial / empty upstream", () => {
  it("upstream erroring mid-stream leaves nothing cached", async () => {
    const d = drive({}, () => {
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          if (!sent) {
            sent = true;
            c.enqueue(enc("PART"));
          } else c.error(new Error("boom"));
        },
      });
      return new Response(body, { headers: { "Content-Length": "100" } });
    });
    await get("view-sm", d);
    expect(await env.CACHE.get(`${P}/view-sm`)).toBeNull();
  });
  it("Content-Length: 0 must not cache an empty image forever", async () => {
    const d = drive(
      {},
      () =>
        new Response(new Uint8Array(0), { headers: { "Content-Length": "0" } }),
    );
    await get("view-sm", d);
    expect(await env.CACHE.get(`${P}/view-sm`)).toBeNull();
  });
});
