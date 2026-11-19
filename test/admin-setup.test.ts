import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import {
  adminAction,
  adminHeaders,
  getStudioName,
  parseDriveFolderId,
} from "../app/lib/server/admin";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { DriveError, FOLDER_MIME } from "../app/lib/server/drive-types";
import type { DriveClient, DriveFile } from "../app/lib/server/drive-types";
import { resetMockDrive } from "../app/lib/server/drive-factory";
import { buildFixtures } from "../app/lib/server/fixtures";
import { exchangeCode, isGoogleConnected } from "../app/lib/server/google-auth";
import {
  SETTINGS_KEYS,
  getSetting,
  putSetting,
} from "../app/lib/server/settings";
import { loader as layoutLoader, adminLayoutData } from "../app/routes/admin";
import { setupAction, setupData } from "../app/routes/admin.setup";
import { loader as rootLoader } from "../app/root";
import { RouterContextProvider } from "react-router";
import { nonceContext } from "../app/lib/server/context";

function ctxWithNonce() {
  const c = new RouterContextProvider();
  c.set(nonceContext, "test-nonce");
  return c;
}

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const nonAdmin = { ...e, ALLOW_DEV_ADMIN: "0" } as Env;
const URL_ = "http://localhost/admin/setup";

const post = (fields: Record<string, string>, headers: HeadersInit = {}) =>
  new Request(URL_, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  });

const folder = (id: string, over: Partial<DriveFile> = {}): DriveFile => ({
  id,
  name: "Mi Carpeta",
  mimeType: FOLDER_MIME,
  modifiedTime: "2026-01-01T00:00:00Z",
  ...over,
});
function stubDrive(files: Record<string, DriveFile>): DriveClient {
  const base = createMockDrive();
  return {
    ...base,
    async getMeta(id: string) {
      const f = files[id];
      if (!f) throw new DriveError(404, "not found", `secret-detail ${id}`);
      return f;
    },
  };
}
const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123";

const status = async (p: Promise<unknown>) =>
  ((await p.catch((x) => x)) as Response).status;

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  resetMockDrive();
  await getDb(env).delete(schema.galleries);
  await getDb(env).delete(schema.settings);
});

describe("adminAction", () => {
  it("401 for non-admin", async () => {
    expect(await status(adminAction(post({}), nonAdmin))).toBe(401);
  });
  it("403 for cross-site (Sec-Fetch-Site)", async () => {
    expect(
      await status(
        adminAction(post({}, { "Sec-Fetch-Site": "cross-site" }), e),
      ),
    ).toBe(403);
  });
  it("403 for foreign Origin", async () => {
    expect(
      await status(adminAction(post({}, { Origin: "https://evil.test" }), e)),
    ).toBe(403);
  });
  it("401 wins over 403 for non-admin cross-site", async () => {
    expect(
      await status(
        adminAction(post({}, { "Sec-Fetch-Site": "cross-site" }), nonAdmin),
      ),
    ).toBe(401);
  });
  it("returns the admin email when ok", async () => {
    const r = await adminAction(
      post({}, { "Sec-Fetch-Site": "same-origin" }),
      e,
    );
    expect(r).toBe("admin@example.com");
  });
});

describe("adminHeaders", () => {
  it("private no-store and noindex", () => {
    const h = adminHeaders();
    expect(h["Cache-Control"]).toBe("private, no-store");
    expect(h["X-Robots-Tag"]).toContain("noindex");
  });
});

describe("parseDriveFolderId", () => {
  it.each([
    [`https://drive.google.com/drive/folders/${ID}?usp=sharing`, ID],
    [`https://drive.google.com/drive/u/0/folders/${ID}`, ID],
    [`https://drive.google.com/drive/u/12/folders/${ID}?resourcekey=x`, ID],
    [`https://drive.google.com/open?id=${ID}`, ID],
    [`  ${ID}  `, ID],
    [ID, ID],
  ])("accepts %s", (input, id) => expect(parseDriveFolderId(input)).toBe(id));
  it.each([
    "",
    "short",
    "has space in it 12345",
    "https://evil.test/drive/folders/" + ID,
    "https://drive.google.com.evil.test/drive/folders/" + ID,
    "javascript:alert(1)",
    `https://drive.google.com/drive/folders/${ID}/../x`.replace(ID, "a b"),
    "https://drive.google.com/drive/folders/",
    "../../etc/passwd1234",
    "a".repeat(300),
  ])("rejects %j", (input) => expect(parseDriveFolderId(input)).toBeNull());
});

describe("setup loader", () => {
  it("401 for non-admin", async () => {
    expect(await status(setupData(new Request(URL_), nonAdmin))).toBe(401);
  });
  it("reports state without secrets", async () => {
    await exchangeCode(
      e,
      "c",
      "http://localhost/admin/google/callback",
      async () =>
        new Response(
          JSON.stringify({
            access_token: "ACCESS-SECRET",
            refresh_token: "REFRESH-SECRET",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/drive.readonly",
          }),
        ),
    );
    await putSetting(e, SETTINGS_KEYS.driveRootId, ID);
    await putSetting(e, "drive_root_name", "Mi Carpeta");
    const d = await setupData(new Request(URL_), e);
    expect(d.connected).toBe(true);
    expect(d.mock).toBe(true);
    expect(d.rootName).toBe("Mi Carpeta");
    const json = JSON.stringify(d);
    for (const s of ["ACCESS-SECRET", "REFRESH-SECRET", ID, "TOKEN_KEY"])
      expect(json).not.toContain(s);
    expect(json).not.toContain(env.TOKEN_KEY);
    expect(json).not.toContain(env.SESSION_SECRET);
  });
});

describe("layout loader", () => {
  it("401 for non-admin", async () => {
    expect(await status(adminLayoutData(new Request(URL_), nonAdmin))).toBe(
      401,
    );
    expect(
      await status(
        layoutLoader({
          request: new Request(URL_),
        } as never) as Promise<unknown>,
      ),
    ).toBe(401);
  });
  it("shows sync state and generic error only", async () => {
    await putSetting(e, "sync_last_ok", "2026-11-16T10:00:00Z");
    await putSetting(
      e,
      SETTINGS_KEYS.syncLastError,
      JSON.stringify({ at: "2026-11-16T11:00:00Z", message: "sync failed" }),
    );
    const d = await adminLayoutData(new Request(URL_), e);
    expect(d.lastSyncAt).toBe("2026-11-16T10:00:00Z");
    expect(d.lastError).toEqual({
      at: "2026-11-16T11:00:00Z",
      message: "sync failed",
    });
    expect(d.mock).toBe(true);
  });
  it("tolerates corrupt last-error", async () => {
    await putSetting(e, SETTINGS_KEYS.syncLastError, "{not json");
    const d = await adminLayoutData(new Request(URL_), e);
    expect(d.lastError).toBeNull();
  });
});

describe("setup actions: guards", () => {
  it.each(["disconnect", "root", "sync", "studio"])(
    "%s: 401 non-admin, 403 cross-site",
    async (intent) => {
      expect(
        await status(setupAction(post({ intent }), nonAdmin, stubDrive({}))),
      ).toBe(401);
      expect(
        await status(
          setupAction(
            post({ intent }, { "Sec-Fetch-Site": "cross-site" }),
            e,
            stubDrive({}),
          ),
        ),
      ).toBe(403);
    },
  );
  it("unknown intent -> 400 error", async () => {
    const r = await setupAction(post({ intent: "zzz" }), e, stubDrive({}));
    expect(r.ok).toBe(false);
  });
});

describe("setup action: disconnect", () => {
  it("removes Google credentials", async () => {
    await exchangeCode(
      e,
      "c",
      "http://localhost/admin/google/callback",
      async () =>
        new Response(
          JSON.stringify({
            access_token: "A",
            refresh_token: "R",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/drive.readonly",
          }),
        ),
    );
    expect(await isGoogleConnected(e)).toBe(true);
    const r = await setupAction(
      post({ intent: "disconnect" }),
      e,
      stubDrive({}),
    );
    expect(r.ok).toBe(true);
    expect(await isGoogleConnected(e)).toBe(false);
  });
});

describe("setup action: root folder", () => {
  const run = (input: string, files: Record<string, DriveFile>) =>
    setupAction(post({ intent: "root", folder: input }), e, stubDrive(files));

  it.each([
    `https://drive.google.com/drive/folders/${ID}?usp=sharing`,
    `https://drive.google.com/drive/u/0/folders/${ID}`,
    `https://drive.google.com/open?id=${ID}`,
    ID,
  ])("saves id + name from %s", async (input) => {
    const r = await run(input, { [ID]: folder(ID) });
    expect(r.ok).toBe(true);
    expect(await getSetting(e, SETTINGS_KEYS.driveRootId)).toBe(ID);
    const d = await setupData(new Request(URL_), e);
    expect(d.rootName).toBe("Mi Carpeta");
    expect(JSON.stringify(d)).not.toContain(ID);
  });
  it("junk input -> Spanish error, nothing saved", async () => {
    const r = await run("hola que tal", {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/enlace|ID/i);
    expect(await getSetting(e, SETTINGS_KEYS.driveRootId)).toBeUndefined();
  });
  it("non-folder -> error", async () => {
    const r = await run(ID, { [ID]: folder(ID, { mimeType: "image/jpeg" }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/carpeta/i);
    expect(await getSetting(e, SETTINGS_KEYS.driveRootId)).toBeUndefined();
  });
  it("trashed -> error", async () => {
    const r = await run(ID, { [ID]: folder(ID, { trashed: true }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/papelera/i);
    expect(await getSetting(e, SETTINGS_KEYS.driveRootId)).toBeUndefined();
  });
  it("Drive 404 -> error without upstream detail", async () => {
    const r = await run(ID, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no se encontr/i);
    expect(JSON.stringify(r)).not.toContain("secret-detail");
    expect(JSON.stringify(r)).not.toContain(ID);
  });
  it("other Drive failure -> generic error", async () => {
    const drive = stubDrive({});
    drive.getMeta = async () => {
      throw new Error(`boom ${ID}`);
    };
    const r = await setupAction(post({ intent: "root", folder: ID }), e, drive);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(ID);
  });
  it("a failed attempt keeps the previous root", async () => {
    await run(ID, { [ID]: folder(ID) });
    await run("x".repeat(12) + "!", {});
    expect(await getSetting(e, SETTINGS_KEYS.driveRootId)).toBe(ID);
  });
});

describe("setup action: sync now", () => {
  it("runs a forced sync and returns counts only", async () => {
    resetMockDrive();
    const drive = createMockDrive();
    const r = await setupAction(post({ intent: "sync" }), e, drive);
    expect(r.ok).toBe(true);
    expect(r.result?.galleries.created).toBeGreaterThan(0);
    await putSetting(e, SETTINGS_KEYS.syncLastOk, "2026-01-01T00:00:00Z"); // past the 30 s cooldown
    const again = await setupAction(post({ intent: "sync" }), e, drive);
    expect(again.result?.skipped).not.toBe("unchanged"); // forced
    const d = await adminLayoutData(new Request(URL_), e);
    expect(d.lastSyncAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });
  it("failure -> Spanish error, last error recorded generically", async () => {
    const drive = createMockDrive();
    drive.getStartPageToken = async () => {
      throw new Error(`leak ${ID}`);
    };
    drive.listChanges = async () => {
      throw new Error(`leak ${ID}`);
    };
    drive.listChildrenMany = async () => {
      throw new Error(`leak ${ID}`);
    };
    drive.getMeta = async () => {
      throw new Error(`leak ${ID}`);
    };
    await putSetting(e, SETTINGS_KEYS.syncLastOk, "2026-01-01T00:00:00Z");
    const r = await setupAction(post({ intent: "sync" }), e, drive);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(ID);
    expect(r.error).toMatch(/sincroniz/i);
  });
});

describe("setup action: studio name + root loader", () => {
  const run = (name: string) =>
    setupAction(post({ intent: "studio", studioName: name }), e, stubDrive({}));
  it("rejects empty / whitespace / >60 / control chars", async () => {
    for (const n of ["", "   ", "x".repeat(61), "a\u0000b", "a\nb"]) {
      const r = await run(n);
      expect(r.ok, JSON.stringify(n)).toBe(false);
      expect(r.error).toBeTruthy();
    }
    expect(await getSetting(e, "studio_name")).toBeUndefined();
  });
  it("accepts 1 and 60 chars, trims, and the root loader uses it", async () => {
    expect((await run("  Estudio Ñandú  ")).ok).toBe(true);
    expect(await getSetting(e, "studio_name")).toBe("Estudio Ñandú");
    expect(await getStudioName(e)).toBe("Estudio Ñandú");
    const rd = (await rootLoader({
      request: new Request("http://localhost/"),
      context: ctxWithNonce(),
    } as never)) as { data?: unknown; studioName?: string };
    const payload = (rd.data ?? rd) as { studioName: string };
    expect(payload.studioName).toBe("Estudio Ñandú");
    expect((await run("x".repeat(60))).ok).toBe(true);
  });
  it("falls back to env STUDIO_NAME", async () => {
    expect(await getStudioName(e)).toBe(env.STUDIO_NAME);
  });
  it("stored value is rendered as data (loader returns it verbatim)", async () => {
    await run("<b>x</b>");
    expect((await setupData(new Request(URL_), e)).studioName).toBe("<b>x</b>");
  });
});

it("fixtures root id is untouched by setup tests", () => {
  expect(buildFixtures().rootId).toBeTruthy();
});

describe("cron records last successful sync", () => {
  it("runScheduledSync sets sync_last_ok", async () => {
    const { runScheduledSync } = await import("../app/lib/server/sync");
    await runScheduledSync(e, createMockDrive());
    expect(await getSetting(e, SETTINGS_KEYS.syncLastOk)).toMatch(/Z$/);
  });
});
