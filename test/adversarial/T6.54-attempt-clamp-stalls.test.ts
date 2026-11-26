import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { hashPin } from "../../app/lib/server/crypto";
import { galleryAction } from "../../app/lib/server/gallery-route";
import { migrateDb, resetTables } from "../support/d1";

// T6.54 (6): the counter is clamped at 100, so the answer to attempt 99 and to
// attempt 100 is the same number; PinScreen keys the alert and the shaking
// field on it, so past 100 nothing re-mounts: no re-announce, no new shake.
const e = { ...env, DRIVE_MODE: "mock" } as Env;
const db = getDb(env);
beforeAll(migrateDb);
beforeEach(() =>
  resetTables("rate_limits", "gallery_views", "photos", "galleries", "clients"),
);
const act = async (attempt: string, n: number) =>
  (await galleryAction(
    {
      request: new Request("https://gallery.381studios.ar/boda", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "CF-Connecting-IP": `198.51.100.${n}`,
          "Sec-Fetch-Site": "same-origin",
        },
        body: new URLSearchParams({ pin: "wrong-pin", attempt }).toString(),
      }),
    },
    { album: "boda" },
    e,
  )) as { data: { attempt: number } };

describe("T6.54 attempt counter clamp", () => {
  it("every refused attempt gets a number different from the one it posted", async () => {
    await db.insert(schema.galleries).values({
      id: "g1",
      driveFolderId: "d1",
      slug: "boda",
      title: "Boda",
      status: "published",
      pinHash: await hashPin("own-album-pin"),
    });
    const a = (await act("99", 1)).data.attempt;
    const b = (await act(String(a), 2)).data.attempt;
    expect(b).not.toBe(a);
  });
});
