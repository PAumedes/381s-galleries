import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { loader as rootLoader } from "../app/root";
import { nonceContext } from "../app/lib/server/context";
import { galleryAction } from "../app/lib/server/admin-galleries";
import { adminIndexData } from "../app/routes/admin._index";
import { setupAction } from "../app/routes/admin.setup";
import type { DriveClient } from "../app/lib/server/drive-types";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const ID = "00000000-0000-4000-8000-000000000a01";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.insert(schema.galleries).values({
    id: ID,
    driveFolderId: "drive-folder-a01",
    slug: "boda",
    title: "Boda",
    status: "draft",
  });
});

const post = (
  fields: Record<string, string>,
  cookie?: string,
  url = "http://localhost/admin/g/x",
) =>
  new Request(url, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: new URLSearchParams(fields),
  });
const bad = { intent: "details", title: "", slug: "boda" };

describe("gallery action messages", () => {
  it("default and invalid cookie -> Spanish", async () => {
    for (const cookie of [
      undefined,
      "admin_lang=fr",
      "admin_lang=EN",
      "lang=en",
    ]) {
      const r = await galleryAction(post(bad, cookie), e, ID);
      expect(r.ok).toBe(false);
      expect(r.error).toBe("Revisá los campos marcados.");
      expect(r.fieldErrors?.title).toBe(
        "El título debe tener entre 1 y 120 caracteres.",
      );
    }
  });
  it("admin_lang=en -> English, field errors too", async () => {
    const r = await galleryAction(post(bad, "admin_lang=en"), e, ID);
    expect(r.error).toBe("Check the highlighted fields.");
    expect(r.fieldErrors?.title).toBe("Title must be 1 to 120 characters.");
  });
  it("success messages and unknown actions are translated", async () => {
    const ok = await galleryAction(
      post({ intent: "design", palette: "oscuro" }, "admin_lang=en"),
      e,
      ID,
    );
    expect(ok).toMatchObject({ ok: true, message: "Design saved." });
    const unk = await galleryAction(
      post({ intent: "zz" }, "admin_lang=en"),
      e,
      ID,
    );
    expect(unk.error).toBe("Unknown action.");
  });
  it("reserved slug and stale reorder in English", async () => {
    const r = await galleryAction(
      post({ intent: "details", title: "x", slug: "admin" }, "admin_lang=en"),
      e,
      ID,
    );
    expect(r.fieldErrors?.slug).toBe("That slug is reserved. Pick another.");
    const s = await galleryAction(
      post(
        { intent: "reorder", order: "{}", version: "nope" },
        "admin_lang=en",
      ),
      e,
      ID,
    );
    expect(s.error).toMatch(/^The gallery's photos changed/);
    expect(s.stale).toBe(true);
  });
});

const drive = {
  getMeta: async () => {
    throw new Error("unused");
  },
} as unknown as DriveClient;

describe("setup action messages", () => {
  it("English from cookie, Spanish otherwise", async () => {
    const en = await setupAction(
      post(
        { intent: "root", folder: "!!" },
        "admin_lang=en",
        "http://localhost/admin/setup",
      ),
      e,
      drive,
    );
    expect(en.error).toBe(
      "We couldn't recognize that link. Paste the Drive folder link or its ID.",
    );
    const es = await setupAction(
      post(
        { intent: "root", folder: "!!" },
        "admin_lang=zz",
        "http://localhost/admin/setup",
      ),
      e,
      drive,
    );
    expect(es.error).toBe(
      "No reconocimos ese enlace. Pegá el enlace de la carpeta de Drive o su ID.",
    );
    const nm = await setupAction(
      post(
        { intent: "studio", studioName: "" },
        "admin_lang=en",
        "http://localhost/admin/setup",
      ),
      e,
      drive,
    );
    expect(nm.error).toBe("The name must be 1 to 60 characters.");
  });
});

describe("admin index google flash message", () => {
  const get = (qs: string, cookie?: string) =>
    adminIndexData(
      new Request(`http://localhost/admin?${qs}`, {
        headers: cookie ? { cookie } : {},
      }),
      e,
    );
  it("is translated", async () => {
    expect((await get("google=connected")).message).toBe(
      "Google Drive conectado correctamente.",
    );
    expect((await get("google=connected", "admin_lang=en")).message).toBe(
      "Google Drive connected successfully.",
    );
    expect(
      (await get("google=error&reason=denied", "admin_lang=en")).message,
    ).toBe("Google authorization was cancelled.");
    expect(
      (await get("google=error&reason=zzz", "admin_lang=en")).message,
    ).toBe("Couldn't connect to Google.");
  });
});

describe("root loader", () => {
  const run = async (url: string, cookie?: string) => {
    const c = new RouterContextProvider();
    c.set(nonceContext, "n");
    const r = (await rootLoader({
      request: new Request(url, { headers: cookie ? { cookie } : {} }),
      context: c,
    } as never)) as { data?: unknown };
    return (r.data ?? r) as { lang: string; messages: Record<string, string> };
  };
  const adminUrls = [
    "http://localhost/admin",
    "http://localhost/admin/setup.data?_routes=root",
  ];
  const withDevAdmin = async (on: boolean, fn: () => Promise<void>) => {
    const live = env as unknown as Record<string, string | undefined>;
    const prev = [live.ALLOW_DEV_ADMIN, live.DRIVE_MODE];
    live.ALLOW_DEV_ADMIN = on ? "1" : undefined;
    live.DRIVE_MODE = on ? "mock" : undefined;
    try {
      await fn();
    } finally {
      [live.ALLOW_DEV_ADMIN, live.DRIVE_MODE] = prev;
    }
  };
  it("verified admin: admin_lang on admin and .data paths, full dictionary", () =>
    withDevAdmin(true, async () => {
      for (const u of adminUrls) {
        const p = await run(u, "admin_lang=en");
        expect(p.lang).toBe("en");
        expect(p.messages["admin.nav.galleries"]).toBe("Galleries");
      }
      expect((await run("http://localhost/admin", "admin_lang=bad")).lang).toBe(
        "es",
      );
    }));
  it("unverified request: admin_lang language, public strings only", () =>
    withDevAdmin(false, async () => {
      for (const u of adminUrls) {
        const p = await run(u, "admin_lang=en");
        expect(p.lang).toBe("en");
        expect(
          Object.keys(p.messages).some((k) => k.startsWith("admin.")),
        ).toBe(false);
      }
    }));
  it("public pages: no admin strings, no admin cookie effect", async () => {
    const p = await run("http://localhost/", "admin_lang=en");
    expect(p.lang).toBe("es");
    expect(Object.keys(p.messages).some((k) => k.startsWith("admin."))).toBe(
      false,
    );
  });
  it("admin pages never set the public lang cookie", async () => {
    const c = new RouterContextProvider();
    c.set(nonceContext, "n");
    const r = (await rootLoader({
      request: new Request("http://localhost/admin?lang=en"),
      context: c,
    } as never)) as { init?: { headers?: Record<string, string> } };
    expect(r.init?.headers?.["Set-Cookie"]).toBeUndefined();
  });
});
