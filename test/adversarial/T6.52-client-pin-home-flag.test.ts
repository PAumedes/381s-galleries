// T6.52 adversary: the stored show_on_home flag is documented as "kept honest"
// (on only for albums that can really appear on the home). A client PIN hides
// the album from the home by SQL only; the flag still goes to 1, so removing
// the PIN (or deleting the client) silently publishes the album on the studio
// home with no further owner action.
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { clientAction } from "../../app/lib/server/admin-clients";
import { hashPin } from "../../app/lib/server/crypto";
import { loadHome } from "../../app/lib/server/home";
import { migrateDb, resetTables } from "../support/d1";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const CA = "cccccccc-0000-0000-0000-0000000000bb";

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("photos", "galleries", "clients");
  await db.insert(schema.clients).values({
    id: CA,
    slug: "acme",
    name: "Acme",
    pinHash: await hashPin("client-pin-1"),
    defaultShowOnHome: true,
    defaultMode: "delivery",
  });
  await db.insert(schema.galleries).values({
    id: "g1",
    driveFolderId: "f1",
    slug: "boda",
    title: "Boda",
    status: "published",
    clientId: CA,
  });
  await db.insert(schema.photos).values({
    id: "p1",
    galleryId: "g1",
    baseName: "IMG_1",
    driveHighresId: "hr",
    driveThumbId: "th",
    driveWebId: "w",
    sort: 0,
    width: 3,
    height: 2,
  });
});

const run = (b: Record<string, string>) =>
  clientAction(
    new Request("http://localhost/admin/clients/" + CA, {
      method: "POST",
      body: new URLSearchParams(b),
    }),
    e,
    CA,
  );
const flag = async () =>
  (
    await env.DB.prepare(
      "SELECT show_on_home h FROM galleries WHERE id='g1'",
    ).first<{
      h: number;
    }>()
  )?.h;

describe("T6.52 adversary: show_on_home stays honest under a client PIN", () => {
  it("apply-defaults does not set show_on_home on albums of a PIN client", async () => {
    await run({ intent: "applyDefaults", confirm: "1" });
    expect(await flag()).toBe(0);
  });

  it("removing the client PIN does not put a never-requested album on the public home", async () => {
    await run({ intent: "applyDefaults", confirm: "1" });
    await run({ intent: "pinRemove" });
    expect(await flag()).toBe(0);
    const home = await loadHome(e);
    expect(JSON.stringify(home)).not.toContain("boda");
  });
});
