import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../../scripts/setup-cloudflare.mjs";

const REAL = "11111111-2222-3333-4444-555555555555";
const CONFIG = `{ "d1_databases": [ { "database_id": "00000000-0000-0000-0000-000000000000" } ] }`;
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });

describe("T6 wrangler stdout with a bracketed prefix", () => {
  it("parses JSON even when a [WARNING]/[wrangler:info] line precedes it", async () => {
    const cfg = path.join(mkdtempSync(path.join(tmpdir(), "t6-")), "w.jsonc");
    writeFileSync(cfg, CONFIG);
    const logs = [];
    const run = async (c, a) => {
      const l = a.join(" ");
      const pre = "▲ [WARNING] update available\n";
      if (l.includes("d1 list"))
        return ok(
          pre + JSON.stringify([{ name: "381s-galleries", uuid: REAL }]),
        );
      if (l.includes("r2 bucket list"))
        return ok("name: 381s-galleries-cache\n");
      if (l.includes("secret list")) return ok(pre + "[]");
      return ok();
    };
    const code = await main({
      run,
      env: { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" },
      log: (m) => logs.push(m),
      configPath: cfg,
    });
    expect(logs.join("\n")).not.toMatch(/::error::/);
    expect(code).toBe(0);
  });
});
