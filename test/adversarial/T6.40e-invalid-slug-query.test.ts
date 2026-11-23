import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";
import { executionContext } from "../../app/lib/server/context";
import { galleryLoader } from "../../app/lib/server/gallery-route";
import { migrateDb } from "../support/d1";
import { countingEnv } from "../support/warm";

const ctx = () => {
  const c = new RouterContextProvider();
  c.set(executionContext, {
    waitUntil() {},
    passThroughException() {},
  } as never);
  return c;
};

beforeAll(migrateDb);

describe("T6.40e adversary: slugs that can never be a client", () => {
  // loadClientPage only skips dotted/reserved segments; a segment that can
  // never match SLUG_RE (or is longer than SLUG_MAX) still costs a second D1
  // query on every scanner hit. It should stop at the album lookup (1 query).
  for (const bad of [
    "has space",
    "a".repeat(200),
    "wp_login",
    "x--y",
    "-lead",
  ]) {
    it(`"${bad.slice(0, 12)}" costs no client query`, async () => {
      const c = countingEnv(env as Env);
      await galleryLoader(
        {
          request: new Request(
            "https://gallery.381studios.ar/" + encodeURIComponent(bad),
          ),
          context: ctx(),
        } as never,
        { album: bad },
        c.e,
      );
      expect(c.count()).toBeLessThanOrEqual(1);
    });
  }
});
