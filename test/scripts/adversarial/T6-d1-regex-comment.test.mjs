import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ensureD1 } from "../../../scripts/setup-cloudflare.mjs";

const REAL = "11111111-2222-3333-4444-555555555555";
it("does not rewrite a database_id mentioned in a comment before the real one", async () => {
  const cfg = path.join(mkdtempSync(path.join(tmpdir(), "t6-")), "w.jsonc");
  const src = `{
  // e.g. "database_id": "example-id"
  "d1_databases": [ { "database_id": "00000000-0000-0000-0000-000000000000" } ]
}`;
  writeFileSync(cfg, src);
  const run = async () => ({
    code: 0,
    stdout: JSON.stringify([{ name: "381s-galleries", uuid: REAL }]),
    stderr: "",
  });
  await ensureD1({ run, log: () => {}, configPath: cfg });
  const out = readFileSync(cfg, "utf8");
  expect(out).toContain('"database_id": "example-id"');
  expect(out).toContain(REAL);
});
