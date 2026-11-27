import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { handleSetApproval } from "../../app/lib/server/approvals";
import { migrateDb, resetTables } from "../support/d1";
import { seedVersioned } from "../support/versions";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000f1";

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables(
    "photo_approvals",
    "favorites",
    "visitors",
    "rate_limits",
    "photo_versions",
    "delivery_rounds",
    "photos",
    "galleries",
  );
});

describe("T6.53f adversary: insertApproval catches everything", () => {
  it("a D1 outage on the INSERT is not reported as a 409 'stale' (client would toast 'changed' and never retry)", async () => {
    await db.insert(schema.galleries).values({
      id: G,
      driveFolderId: "f",
      slug: "retoque",
      title: "R",
      status: "published",
      versioning: true,
      requireEmail: false,
    });
    await seedVersioned(G, "A", [{ n: 1 }]);
    const failing = {
      ...env,
      DB: new Proxy(env.DB, {
        get(t, k) {
          if (k === "prepare")
            return (sql: string) => {
              if (/INSERT OR IGNORE INTO photo_approvals/.test(sql))
                throw new Error("D1_ERROR: network connection lost");
              return t.prepare(sql);
            };
          const v = (t as never)[k];
          return typeof v === "function" ? v.bind(t) : v;
        },
      }),
    } as Env;
    const res = await handleSetApproval(
      new Request("https://x.test/api/g/retoque/approvals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "1.1.1.1",
        },
        body: JSON.stringify({ photoId: "A", version: 1, on: true }),
      }),
      "retoque",
      failing,
    );
    expect(res.status).not.toBe(409);
  });
});
