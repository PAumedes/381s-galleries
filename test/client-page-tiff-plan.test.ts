import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { allTiffNoPreviewSql } from "../app/lib/server/cover";
import { migrateDb } from "./support/d1";

// T6.53d2: the TIFF-only probe must reach `photos` through an index on
// gallery_id (never a full scan per album).
beforeAll(migrateDb);

describe("T6.53d2 allTiffNoPreviewSql query plan", () => {
  it("probes photos by index, not by scan", async () => {
    const q = getDb(env)
      .select({ x: allTiffNoPreviewSql(), id: schema.galleries.id })
      .from(schema.galleries)
      .toSQL();
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
      .bind(...q.params)
      .all<{ detail: string }>();
    const lines = plan.results.map((r) => r.detail);
    const photoLines = lines.filter((l) => /photos/.test(l));
    expect(photoLines.length).toBeGreaterThan(0);
    for (const l of photoLines) expect(l).toMatch(/USING (COVERING )?INDEX/);
  });
});
