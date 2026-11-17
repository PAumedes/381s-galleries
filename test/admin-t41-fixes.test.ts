import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { parseDriveFolderId } from "../app/lib/server/admin";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import type { DriveClient } from "../app/lib/server/drive-types";
import {
  deleteSetting,
  getSetting,
  putSetting,
  SETTINGS_KEYS,
} from "../app/lib/server/settings";
import { runSync } from "../app/lib/server/sync";
import { setupAction } from "../app/routes/admin.setup";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const post = (f: Record<string, string>) =>
  new Request("http://localhost/admin/setup", {
    method: "POST",
    body: new URLSearchParams(f),
  });
const OLD = "1OldRootFolderIdAbcdef12345";
const NEW = "1NewRootFolderIdAbcdef12345";
const stub = (): DriveClient => ({
  ...createMockDrive(),
  getMeta: async (id: string) => ({
    id,
    name: "N",
    mimeType: FOLDER_MIME,
    modifiedTime: "2026-01-01T00:00:00Z",
  }),
});

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

describe("root change confirm", () => {
  it("requires server-side confirm when a different root exists", async () => {
    await putSetting(e, SETTINGS_KEYS.driveRootId, OLD);
    await putSetting(e, SETTINGS_KEYS.driveChangesToken, "tok");
    const r = await setupAction(
      post({ intent: "root", folder: NEW }),
      e,
      stub(),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/archiv.*1 hora/i);
    expect(await getSetting(e, SETTINGS_KEYS.driveRootId)).toBe(OLD);
    expect(await getSetting(e, SETTINGS_KEYS.driveChangesToken)).toBe("tok");
  });
  it("with confirm saves and deletes the changes token", async () => {
    const r = await setupAction(
      post({ intent: "root", folder: NEW, confirm: "1" }),
      e,
      stub(),
    );
    expect(r.ok).toBe(true);
    expect(await getSetting(e, SETTINGS_KEYS.driveRootId)).toBe(NEW);
    expect(
      await getSetting(e, SETTINGS_KEYS.driveChangesToken),
    ).toBeUndefined();
  });
  it("same root needs no confirm", async () => {
    const r = await setupAction(
      post({ intent: "root", folder: NEW }),
      e,
      stub(),
    );
    expect(r.ok).toBe(true);
  });
  it("galleries outside the new root are not archived on the first run", async () => {
    await getDb(e).delete(schema.galleries);
    await deleteSetting(e, SETTINGS_KEYS.driveRootId);
    await deleteSetting(e, SETTINGS_KEYS.driveChangesToken);
    const drive = createMockDrive();
    await runSync(e, { drive });
    const before = await getDb(e).select().from(schema.galleries);
    expect(before.length).toBeGreaterThan(0);
    const other: DriveClient = {
      ...stub(),
      listChildrenMany: async (ids: string[]) =>
        new Map(
          ids.map((i) => [
            i,
            i === NEW
              ? [
                  {
                    id: "1OtherAlbumFolderAbcdef1234",
                    name: "Otro",
                    mimeType: FOLDER_MIME,
                    modifiedTime: "2026-01-01T00:00:00Z",
                  },
                ]
              : [],
          ]),
        ),
    };
    const s = await setupAction(
      post({ intent: "root", folder: NEW, confirm: "1" }),
      e,
      other,
    );
    expect(s.ok).toBe(true);
    const r = await runSync(e, { drive: other });
    expect(r.skipped).toBeUndefined();
    expect(r.galleries.archived).toBe(0);
    const rows = await getDb(e).select().from(schema.galleries);
    expect(rows.filter((g) => g.status === "archived")).toHaveLength(0);
  });
});

describe("sync now cooldown", () => {
  it("rejects within 30s of sync_last_ok", async () => {
    await putSetting(e, SETTINGS_KEYS.syncLastOk, new Date().toISOString());
    const r = await setupAction(post({ intent: "sync" }), e, createMockDrive());
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Se sincronizó hace instantes");
  });
  it("allows after 30s", async () => {
    await deleteSetting(e, SETTINGS_KEYS.driveRootId);
    await deleteSetting(e, SETTINGS_KEYS.driveChangesToken);
    await putSetting(
      e,
      SETTINGS_KEYS.syncLastOk,
      new Date(Date.now() - 31_000).toISOString(),
    );
    const r = await setupAction(post({ intent: "sync" }), e, createMockDrive());
    expect(r.ok).toBe(true);
  });
});

describe("parseDriveFolderId extras", () => {
  const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123";
  it.each([
    `drive.google.com/drive/folders/${ID}`,
    `drive.google.com/drive/folders/${ID}?usp=sharing`,
    `https://drive.google.com/drive/mobile/folders/${ID}`,
    `https://drive.google.com/drive/folders/${ID}/extra/seg`,
    `https://drive.google.com/drive/folders/${ID}#frag`,
    `https://drive.google.com/drive/u/1/folders/${ID}/view#x`,
  ])("accepts %s", (u) => expect(parseDriveFolderId(u)).toBe(ID));
  it.each([
    `https://evil.com/drive/folders/${ID}`,
    `drive.google.com.evil.com/drive/folders/${ID}`,
    `http://drive.google.com/drive/folders/${ID}`,
  ])("rejects %s", (u) => expect(parseDriveFolderId(u)).toBeNull());
});
