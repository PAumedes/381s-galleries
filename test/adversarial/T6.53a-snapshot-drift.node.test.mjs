import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// drizzle-kit generate on the committed migrations/ + schema.ts must be a no-op.
describe("T6.53a adversarial: drizzle snapshot matches schema.ts", () => {
  it("drizzle-kit generate produces no new migration", () => {
    const root = resolve(import.meta.dirname, "../..");
    const dir = mkdtempSync(join(tmpdir(), "dk-"));
    cpSync(join(root, "migrations"), join(dir, "migrations"), {
      recursive: true,
    });
    mkdirSync(join(dir, "app"));
    symlinkSync(join(root, "app/db"), join(dir, "app/db"));
    symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
    writeFileSync(
      join(dir, "dc.ts"),
      `import { defineConfig } from "drizzle-kit";
export default defineConfig({ dialect: "sqlite", schema: "./app/db/schema.ts", out: "./migrations" });`,
    );
    const before = readdirSync(join(dir, "migrations")).sort();
    execFileSync(
      join(root, "node_modules/.bin/drizzle-kit"),
      ["generate", "--config", "dc.ts"],
      {
        cwd: dir,
        stdio: "pipe",
      },
    );
    const after = readdirSync(join(dir, "migrations")).sort();
    expect(after).toEqual(before);
  });
});
