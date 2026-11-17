import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { getStudioName, validStudioName } from "../../app/lib/server/admin";
import { putSetting, SETTINGS_KEYS } from "../../app/lib/server/settings";
import { loader as homeLoader } from "../../app/routes/home";

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

describe("T4.1 studio name", () => {
  it("landing page (home loader/meta title/logo) honours the studio_name override", async () => {
    await putSetting(env, SETTINGS_KEYS.studioName, "Override Studio");
    const r = (await homeLoader()) as { studioName: string };
    expect(r.studioName).toBe("Override Studio");
  });

  it("a D1 failure must fall back to env STUDIO_NAME, not take every page down", async () => {
    const broken = {
      STUDIO_NAME: "Fallback",
      DB: {
        prepare() {
          throw new Error("D1 down");
        },
      },
    } as unknown as Env;
    await expect(getStudioName(broken)).resolves.toBe("Fallback");
  });

  it.each([
    ["‮", "bidi override"],
    ["​​", "zero-width only"],
    ["ㅤ", "hangul filler (invisible)"],
    ["a b", "line separator"],
    ["a\u0085b", "C1 NEL control"],
  ])("rejects invisible/control names: %j (%s)", (name) => {
    expect(validStudioName(name)).toBeNull();
  });
});
