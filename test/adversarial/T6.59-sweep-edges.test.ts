import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  emptySweepTotals,
  sweepPage,
} from "../../app/lib/server/orphan-sweep";
import { getSetting, SETTINGS_KEYS } from "../../app/lib/server/settings";
import { setupAction } from "../../app/routes/admin.setup";
import { migrateDb, resetTables } from "../support/d1";
import { fakeBucket, uuid } from "../support/fake-r2";

const base = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const post = (fields: Record<string, string>) =>
  new Request("http://localhost/admin/setup", {
    method: "POST",
    body: new URLSearchParams(fields),
  });

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("settings", "photos", "galleries");
});

describe("T6.59 adversarial", () => {
  it("a scan started from a forged cursor near the end must not count as the finished full dry run", async () => {
    const f = fakeBucket(3000);
    const sorted = [...f.live].sort();
    const e = { ...base, CACHE: f.bucket as R2Bucket } as Env;
    const r = await setupAction(
      post({ intent: "sweepScan", cursor: sorted[sorted.length - 2] }),
      e,
    );
    expect(r.sweep?.done).toBe(true);
    // a 1-key "scan" unlocks the delete pass for the whole bucket
    expect(await getSetting(e, SETTINGS_KEYS.orphanSweepScanned)).toBeNull();
  });

  it("truncated=true without a cursor is an incomplete listing, not 'done'", async () => {
    const bucket = {
      list: async () => ({
        objects: [{ key: `${uuid(1)}/thumb`, size: 1, uploaded: new Date(0) }],
        truncated: true,
        cursor: undefined,
      }),
      delete: async () => {},
    } as unknown as R2Bucket;
    const e = { ...base, CACHE: bucket } as Env;
    const r = await setupAction(post({ intent: "sweepScan" }), e);
    expect(r.ok).toBe(false);
    expect(await getSetting(e, SETTINGS_KEYS.orphanSweepScanned)).toBeNull();
  });

  it("an Invalid Date `uploaded` must hold the object like a missing one (age protection)", async () => {
    const deleted: string[] = [];
    const bucket = {
      list: async () => ({
        objects: [
          { key: `${uuid(2)}/thumb`, size: 1, uploaded: new Date(Number.NaN) },
        ],
        truncated: false,
      }),
      delete: async (k: string[]) => void deleted.push(...k),
    } as unknown as R2Bucket;
    await sweepPage({ ...env, CACHE: bucket } as Env, {
      mode: "delete",
      cursor: null,
      totals: emptySweepTotals(),
    });
    expect(deleted).toEqual([]);
  });

  it("a listing that returns the same cursor must not make the loop continue forever", async () => {
    const bucket = {
      list: async (o: { cursor?: string }) => ({
        objects: [{ key: `${uuid(3)}/thumb`, size: 1, uploaded: new Date(0) }],
        truncated: true,
        cursor: o.cursor ?? "c",
      }),
      delete: async () => {},
    } as unknown as R2Bucket;
    const page = await sweepPage({ ...env, CACHE: bucket } as Env, {
      mode: "scan",
      cursor: "c",
      totals: emptySweepTotals(),
    });
    expect(page.cursor).not.toBe("c");
  });
});
