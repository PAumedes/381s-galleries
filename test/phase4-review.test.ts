import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { buildFixtures } from "../app/lib/server/fixtures";
import {
  SETTINGS_KEYS,
  deleteSetting,
  getSetting,
  putSetting,
} from "../app/lib/server/settings";
import { runScheduledSync } from "../app/lib/server/sync";
import { handleSync } from "../app/routes/api.admin.sync";
import { setupAction } from "../app/routes/admin.setup";
import { loader as connect } from "../app/routes/admin.google.connect";
import { loader as callback } from "../app/routes/admin.google.callback";
import { fmtTime } from "../app/components/admin/AdminShell";
import { formatEventDate } from "../app/lib/event-date";
import { fmtBa } from "../app/lib/ba-time";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.delete(schema.settings);
  await db
    .insert(schema.settings)
    .values({ key: "drive_root_id", value: buildFixtures().rootId });
});

describe("migration 0009 indexes", () => {
  it("creates downloads_gallery_bulk_idx and favorites_gallery_visitor_idx", async () => {
    const rows = await env.DB.prepare(
      "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name IN ('downloads_gallery_bulk_idx','favorites_gallery_visitor_idx')",
    ).all<{ name: string; tbl_name: string; sql: string }>();
    const by = Object.fromEntries(rows.results.map((r) => [r.name, r]));
    expect(by.downloads_gallery_bulk_idx.tbl_name).toBe("downloads");
    expect(by.downloads_gallery_bulk_idx.sql).toMatch(/gallery_id.*bulk_id/s);
    expect(by.favorites_gallery_visitor_idx.tbl_name).toBe("favorites");
    expect(by.favorites_gallery_visitor_idx.sql).toMatch(
      /gallery_id.*visitor_id/s,
    );
  });
});

describe("/api/admin/sync CSRF + sync_last_ok", () => {
  const same = {
    Origin: "http://localhost",
    "Sec-Fetch-Site": "same-origin",
  };
  const req = (headers: HeadersInit) =>
    new Request("http://localhost/api/admin/sync", { method: "POST", headers });

  it("same-site (not same-origin) POST is refused", async () => {
    const r = await handleSync(
      req({ "Sec-Fetch-Site": "same-site" }),
      e,
      createMockDrive(),
    );
    expect(r.status).toBe(403);
  });
  it("same-origin POST succeeds and records sync_last_ok", async () => {
    expect(await getSetting(e, SETTINGS_KEYS.syncLastOk)).toBeUndefined();
    const r = await handleSync(req(same), e, createMockDrive());
    expect(r.status).toBe(200);
    expect(await getSetting(e, SETTINGS_KEYS.syncLastOk)).toMatch(/Z$/);
  });
  it("API sync clears a previous sync_last_error", async () => {
    await putSetting(
      e,
      SETTINGS_KEYS.syncLastError,
      '{"at":"x","message":"y"}',
    );
    await handleSync(req(same), e, createMockDrive());
    expect(await getSetting(e, SETTINGS_KEYS.syncLastError)).toBeUndefined();
  });
  it("setup button sync and cron both record sync_last_ok", async () => {
    await deleteSetting(e, SETTINGS_KEYS.syncLastOk);
    const form = new Request("http://localhost/admin/setup", {
      method: "POST",
      body: new URLSearchParams({ intent: "sync" }),
    });
    await setupAction(form, e, createMockDrive());
    expect(await getSetting(e, SETTINGS_KEYS.syncLastOk)).toMatch(/Z$/);
    await deleteSetting(e, SETTINGS_KEYS.syncLastOk);
    await runScheduledSync(e, createMockDrive());
    expect(await getSetting(e, SETTINGS_KEYS.syncLastOk)).toMatch(/Z$/);
  });
});

describe("google connect/callback route auth", () => {
  const nonAdmin = { ...e, ALLOW_DEV_ADMIN: "0" } as Env;
  void nonAdmin;
  it("401 for non-admins at the route level", async () => {
    // Routes read the global env; ALLOW_DEV_ADMIN is unset in the test pool.
    for (const fn of [connect, callback]) {
      const r = (await (fn as (a: unknown) => Promise<unknown>)({
        request: new Request("http://localhost/admin/google/x"),
      }).catch((x) => x)) as Response;
      expect(r.status).toBe(401);
    }
  });
});

describe("shared helpers", () => {
  it("fmtTime shows Buenos Aires time, no UTC", () => {
    expect(fmtTime("2026-11-16T13:05:09Z")).toBe("16/11/2026 10:05");
  });
  it("ba-time exports fmtBa", () => {
    expect(fmtBa("2026-01-01T02:30:00Z")).toBe("31/12/2025 23:30");
  });
  it("formatEventDate formats in the language, UTC, null for bad", () => {
    expect(formatEventDate("2026-11-01", "es")).toMatch(
      /1 de noviembre de 2026/,
    );
    expect(formatEventDate("2026-11-01", "en")).toMatch(/November 1, 2026/);
    expect(formatEventDate(null, "es")).toBeNull();
    expect(formatEventDate("nope", "es")).toBeNull();
  });
});
