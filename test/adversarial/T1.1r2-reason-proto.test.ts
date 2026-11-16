import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { adminIndexData } from "../../app/routes/admin._index";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;

beforeAll(async () => {
  await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS);
});

describe("T1.1r2 admin index reason lookup", () => {
  for (const reason of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    it(`reason=${reason} yields a string or null message, never a non-string`, async () => {
      const r = await adminIndexData(
        new Request(`http://localhost/admin?google=error&reason=${reason}`),
        e,
      );
      expect(r.message === null || typeof r.message === "string").toBe(true);
    });
  }
});
