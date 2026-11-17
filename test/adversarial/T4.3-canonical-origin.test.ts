import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { cardData } from "../../app/routes/admin.g.$id.card";
import { editData } from "../../app/routes/admin.g.$id";

const ID = "00000000-0000-4000-8000-0000000000d3";
const e = {
  ...env,
  DRIVE_MODE: "mock",
  ALLOW_DEV_ADMIN: "1",
  PUBLIC_ORIGIN: "https://galleries.example.com",
} as unknown as Env;

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
  await getDb(env).delete(schema.galleries);
  await getDb(env).insert(schema.galleries).values({
    id: ID,
    driveFolderId: "f-d3",
    slug: "boda-d3",
    title: "Boda",
    status: "published",
  });
});

describe("T4.3 public URL must not depend on the request host", () => {
  const r = () => new Request(`http://localhost:5173/admin/g/${ID}/card`);
  it("card QR/url uses a configured canonical origin", async () => {
    const d = await cardData(r(), e, ID);
    expect(d.url).toBe("https://galleries.example.com/boda-d3");
  });
  it("share panel origin uses a configured canonical origin", async () => {
    const d = await editData(r(), e, ID);
    expect(d.origin).toBe("https://galleries.example.com");
  });
});
