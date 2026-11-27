import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HELP_SECTIONS } from "../../app/lib/help";

// T6.57: every "?" link on an admin screen points at a question that exists.
describe("T6.57 help: links from the admin screens", () => {
  it("every help=... / topic=... in the admin components names a real question", () => {
    const dir = "app/components/admin";
    const found = new Set();
    for (const f of readdirSync(dir, { recursive: true }).map(String))
      if (/\.tsx$/.test(f))
        for (const m of readFileSync(`${dir}/${f}`, "utf8").matchAll(
          /\b(?:help|topic)="([a-z0-9-]+)"/g,
        ))
          found.add(m[1]);
    expect(found.size).toBeGreaterThanOrEqual(10);
    const ids = new Set(HELP_SECTIONS.flatMap((s) => s.items.map((i) => i.id)));
    expect([...found].filter((id) => !ids.has(id))).toEqual([]);
  });
});
