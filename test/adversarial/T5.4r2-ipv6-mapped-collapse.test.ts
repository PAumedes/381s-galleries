import { expect, it } from "vitest";
import { ipv6Prefix64 } from "../../app/lib/server/access";

it("different IPv4-mapped IPv6 clients do not share one limiter bucket", () => {
  expect(ipv6Prefix64("::ffff:1.2.3.4")).not.toBe(
    ipv6Prefix64("::ffff:5.6.7.8"),
  );
});

it("different NAT64 clients (64:ff9b::/96) do not share one bucket", () => {
  expect(ipv6Prefix64("64:ff9b::1.2.3.4")).not.toBe(
    ipv6Prefix64("64:ff9b::5.6.7.8"),
  );
});
