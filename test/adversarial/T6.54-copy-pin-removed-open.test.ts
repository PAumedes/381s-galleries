import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { enAdmin } from "../../app/i18n/en.admin";
import { makeT } from "../../app/i18n/t";
import { hashPin } from "../../app/lib/server/crypto";
import { loadGallery } from "../../app/lib/server/gallery";
import { savePin } from "../../app/lib/server/admin-galleries/actions/pin";
import { migrateDb, resetTables } from "../support/d1";

// T6.54 (3): "PIN removed. The gallery is open to anyone with the link" is
// shown even when the album's CLIENT still has a PIN, so the album stays locked.
const e = { ...env, DRIVE_MODE: "mock" } as Env;
const db = getDb(env);
beforeAll(migrateDb);
beforeEach(() =>
  resetTables("rate_limits", "gallery_views", "photos", "galleries", "clients"),
);

describe("T6.54 album 'PIN removed' message vs client PIN", () => {
  it("does not claim the album is open to anyone while the client PIN still locks it", async () => {
    await db.insert(schema.clients).values({
      id: "c1",
      slug: "acme",
      name: "Acme",
      pinHash: await hashPin("client-pin-1"),
    });
    await db.insert(schema.galleries).values({
      id: "g1",
      driveFolderId: "d1",
      slug: "boda",
      title: "Boda",
      status: "published",
      clientId: "c1",
      pinHash: await hashPin("own-album-pin"),
    });
    const t = makeT("en", enAdmin);
    const fd = new FormData();
    fd.set("mode", "remove");
    const res = (await savePin(e, { id: "g1" } as never, fd, t)) as unknown;
    const text = JSON.stringify(res);
    const after = (
      await loadGallery(
        new Request("https://gallery.381studios.ar/acme/boda"),
        "boda",
        e,
      )
    ).data;
    expect(after.state).toBe("locked"); // still locked by the client PIN
    expect(text).not.toMatch(/open to anyone/i);
  });
});
