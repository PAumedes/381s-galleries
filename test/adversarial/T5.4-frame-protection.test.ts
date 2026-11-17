import { expect, it } from "vitest";
import { adminHeaders } from "../../app/lib/server/admin";
import { headers as slugHeaders } from "../../app/routes/$slug";

const framed = (h: Headers | Record<string, string>) => {
  const hh = new Headers(h as HeadersInit);
  return (
    /deny|sameorigin/i.test(hh.get("X-Frame-Options") ?? "") ||
    /frame-ancestors/i.test(hh.get("Content-Security-Policy") ?? "")
  );
};

it("admin pages forbid framing (clickjacking of Sync/Disconnect buttons)", () => {
  expect(framed(adminHeaders())).toBe(true);
});

it("the PIN / gallery page forbids framing", () => {
  const h = (slugHeaders as (a: unknown) => Headers)({
    loaderHeaders: new Headers(),
    actionHeaders: new Headers(),
  });
  expect(framed(h)).toBe(true);
});
