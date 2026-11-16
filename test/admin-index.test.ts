import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { disconnectGoogle, exchangeCode } from "../app/lib/server/google-auth";
import { adminIndexData } from "../app/routes/admin._index";

const e = {
  ...env,
  GOOGLE_CLIENT_ID: "c",
  GOOGLE_CLIENT_SECRET: "s",
  DRIVE_MODE: "mock",
  ALLOW_DEV_ADMIN: "1",
} as Env;

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

describe("/admin index", () => {
  it("401 for non-admin", async () => {
    const r = await adminIndexData(new Request("https://x.test/admin"), {
      ...e,
      ALLOW_DEV_ADMIN: "0",
    } as Env).catch((x) => x as Response);
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(401);
  });

  it("reports connection status and flag message", async () => {
    await disconnectGoogle(e);
    const off = await adminIndexData(
      new Request("http://localhost/admin?google=error&reason=scope"),
      e,
    );
    expect(off.connected).toBe(false);
    expect(off.message).toContain("permisos");
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
    const on = await adminIndexData(
      new Request("http://localhost/admin?google=connected"),
      e,
    );
    expect(on.connected).toBe(true);
    expect(on.message).toContain("conectado");
  });
});
