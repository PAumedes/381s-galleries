import { expect, it } from "vitest";
import { applySecurityHeaders } from "../../app/lib/server/security-headers";

it("keeps every Set-Cookie, Content-Disposition, Location and Cache-Control", () => {
  const h = new Headers();
  h.append("Set-Cookie", "a=1; Path=/");
  h.append("Set-Cookie", "b=2; Path=/");
  h.set("Content-Disposition", 'attachment; filename="x.zip"');
  h.set("Cache-Control", "private, max-age=5");
  h.set("Location", "/x");
  const r = applySecurityHeaders(
    new Response(null, { status: 303, headers: h }),
    {
      nonce: "n",
      mock: false,
    },
  );
  expect(r.status).toBe(303);
  expect(r.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  expect(r.headers.get("Content-Disposition")).toBe(
    'attachment; filename="x.zip"',
  );
  expect(r.headers.get("Cache-Control")).toBe("private, max-age=5");
  expect(r.headers.get("Location")).toBe("/x");
});
