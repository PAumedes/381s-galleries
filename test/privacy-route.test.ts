import { describe, expect, it } from "vitest";
import { loader as legacyLoader } from "../app/routes/privacidad";
import { loader } from "../app/routes/privacy";

const call = (fn: unknown, url: string) =>
  (fn as (a: unknown) => unknown)({
    request: new Request(url),
    params: {},
    context: { get: () => undefined },
  });

describe("privacy routes", () => {
  it("/privacidad redirects 301 to /privacy, keeping ?lang", async () => {
    let res: Response | undefined;
    try {
      res = (await call(
        legacyLoader,
        "https://x.test/privacidad?lang=en",
      )) as Response;
    } catch (e) {
      res = e as Response;
    }
    expect(res?.status).toBe(301);
    expect(res?.headers.get("Location")).toBe("/privacy?lang=en");
  });
  it("/privacy loader serves data (200) with no PUBLIC_CONTACT_EMAIL by default", async () => {
    const r = (await call(loader, "https://x.test/privacy")) as {
      data?: { contactEmail?: string | null };
    };
    expect(JSON.stringify(r)).not.toContain("@");
  });
});
