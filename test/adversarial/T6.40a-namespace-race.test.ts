import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateDb, resetTables } from "../support/d1";
import { getDb, schema } from "../../app/db";
import { eq } from "drizzle-orm";
import { createClient, updateClient } from "../../app/lib/server/clients";
import { saveDetails } from "../../app/lib/server/admin-galleries/actions/details";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../../app/lib/server/drive-types";
import { runSync } from "../../app/lib/server/sync";

beforeAll(migrateDb);
beforeEach(() => resetTables("galleries", "clients", "settings"));

/** DB whose namespace pre-check (slugInUse) always sees "free": simulates losing the race. */
function blindEnv(): Env {
  const DB = new Proxy(env.DB, {
    get(t, k) {
      const v = (t as never)[k];
      if (k === "prepare")
        return (sql: string) =>
          /UNION ALL SELECT 'c'/.test(sql)
            ? { bind: () => ({ all: async () => ({ results: [] }) }) }
            : (v as (s: string) => unknown).call(t, sql);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  return { ...env, DB } as Env;
}

const t = ((k: string) => k) as never;

describe("T6.40a: trigger abort (lost race) must degrade like a slug collision", () => {
  it("saveDetails: renaming a gallery onto a slug a client just took returns a slug field error, not a 500", async () => {
    const db = getDb(env);
    await db
      .insert(schema.galleries)
      .values({ id: "g1", driveFolderId: "f1", slug: "mine", title: "T" });
    await createClient(env as Env, { name: "Taken", slug: "taken" });
    const [g] = await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.id, "g1"));
    const f = new FormData();
    f.set("title", "T");
    f.set("slug", "taken");
    const r = (await saveDetails(blindEnv(), g!, f, t)) as {
      fieldErrors?: Record<string, string>;
    };
    expect(r.fieldErrors?.slug).toBeTruthy();
  });

  it("createClient: lost race against a gallery slug is ClientError slugTaken", async () => {
    await getDb(env)
      .insert(schema.galleries)
      .values({ id: "g2", driveFolderId: "f2", slug: "acme", title: "T" });
    await expect(
      createClient(blindEnv(), { name: "Acme", slug: "acme" }),
    ).rejects.toMatchObject({ code: "slugTaken" });
  });

  it("updateClient: lost race against a gallery slug is ClientError slugTaken", async () => {
    await getDb(env)
      .insert(schema.galleries)
      .values({ id: "g3", driveFolderId: "f3", slug: "acme2", title: "T" });
    const c = await createClient(env as Env, { name: "Zed", slug: "zed" });
    await expect(
      updateClient(blindEnv(), c.id, { slug: "acme2" }),
    ).rejects.toMatchObject({ code: "slugTaken" });
  });

  it("sync: a client created after the slug snapshot must not abort the whole sync", async () => {
    // Snapshot of client slugs is taken, then a client appears with the slug the
    // new album would get: simulate by making the client select return nothing.
    const db = getDb(env);
    await db
      .insert(schema.settings)
      .values({ key: "drive_root_id", value: "root" });
    await createClient(env as Env, { name: "Wedding", slug: "wedding" });
    const DB = new Proxy(env.DB, {
      get(t, k) {
        const v = (t as never)[k];
        if (k === "prepare")
          return (sql: string) => (v as (s: string) => unknown).call(t, sql);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const T = "2026-01-01T00:00:00.000Z";
    const drive = createMockDrive({
      rootId: "root",
      entries: [
        {
          id: "root",
          name: "root",
          mimeType: FOLDER_MIME,
          modifiedTime: T,
          parentId: null,
        },
        {
          id: "a0",
          name: "Wedding",
          mimeType: FOLDER_MIME,
          modifiedTime: T,
          parentId: "root",
        },
        {
          id: "a1",
          name: "Other",
          mimeType: FOLDER_MIME,
          modifiedTime: T,
          parentId: "root",
        },
      ],
    });
    // Hide client slugs from the sync's snapshot only (drizzle select of "slug" from clients).
    const e = {
      ...env,
      DRIVE_MODE: "mock",
      DB: new Proxy(DB, {
        get(t, k) {
          const v = (t as never)[k];
          if (k === "prepare")
            return (sql: string) =>
              /^select "slug" from "clients"/.test(sql)
                ? (v as (s: string) => unknown).call(
                    t,
                    'select "slug" from "clients" where 0',
                  )
                : (v as (s: string) => unknown).call(t, sql);
          return typeof v === "function" ? v.bind(t) : v;
        },
      }),
    } as Env;
    const r = await runSync(e, {
      drive,
      budget: 100000,
      now: new Date("2026-03-01T12:00:00Z"),
    });
    expect(r.galleries.created).toBe(2);
  });
});
