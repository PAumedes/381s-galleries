import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { helpData } from "../app/lib/server/admin-help";
import routes from "../app/routes";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const nonAdmin = { ...e, ALLOW_DEV_ADMIN: "0" } as Env;

describe("T6.57 admin help route", () => {
  it("is registered inside the admin layout as admin/ayuda", () => {
    const admin = routes.find((r) => "path" in r && r.path === "admin") as {
      children?: { path?: string; file: string }[];
    };
    const help = admin.children?.find((c) => c.path === "ayuda");
    expect(help?.file).toBe("routes/admin.ayuda.tsx");
  });

  it("needs the admin login like every other admin page", async () => {
    const req = new Request("https://x.test/admin/ayuda");
    let status = 0;
    try {
      await helpData(req, nonAdmin);
    } catch (x) {
      status = (x as Response).status;
    }
    expect(status).toBe(401);
  });

  it("answers the admin with nothing secret (no data at all)", async () => {
    const out = await helpData(new Request("http://localhost/admin/ayuda"), e);
    expect(out).toEqual({});
  });
});
