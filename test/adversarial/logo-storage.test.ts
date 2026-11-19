import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import {
  getLogoVersions,
  saveLogo,
  serveLogo,
  validateLogo,
} from "../../app/lib/server/logo";
import { PNG, JPEG, bytes, svg } from "../logo-fixtures";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await getDb(env).delete(schema.settings);
  for (const o of (await env.CACHE.list()).objects)
    await env.CACHE.delete(o.key);
});

/** D1 whose settings INSERTs can be failed or held back. */
function flakyDb(hook: (sql: string) => Promise<void>): D1Database {
  return new Proxy(env.DB, {
    get(t, p) {
      if (p !== "prepare")
        return Reflect.get(t, p).bind?.(t) ?? Reflect.get(t, p);
      return (sql: string) => {
        const stmt = t.prepare(sql);
        const wrap = (s: D1PreparedStatement): D1PreparedStatement =>
          new Proxy(s, {
            get(st, q) {
              const v = Reflect.get(st, q);
              if (q === "bind") return (...a: unknown[]) => wrap(st.bind(...a));
              if (q === "run" || q === "all" || q === "raw" || q === "first")
                return async (...a: unknown[]) => {
                  await hook(sql);
                  return (v as (...x: unknown[]) => unknown).apply(st, a);
                };
              return typeof v === "function" ? v.bind(st) : v;
            },
          });
        return wrap(stmt);
      };
    },
  });
}
const isSettingsWrite = (sql: string) =>
  /insert\s+into\s+"?settings/i.test(sql);

const get = (variant: string, v?: string) =>
  serveLogo(
    new Request(`https://x.example/brand/logo/${variant}${v ? `?v=${v}` : ""}`),
    variant,
    env,
  );

describe("adversarial: logo storage consistency", () => {
  it("a failed D1 write during REPLACE must not leave the published logo 404ing", async () => {
    await saveLogo(env, "on-light", PNG);
    const before = (await getLogoVersions(env)).onLight!;
    expect((await get("on-light", before)).status).toBe(200);

    const broken = {
      ...env,
      DB: flakyDb(async (sql) => {
        if (isSettingsWrite(sql)) throw new Error("D1 down");
      }),
    } as unknown as Env;
    await expect(saveLogo(broken, "on-light", JPEG)).rejects.toThrow();

    // Root loader still announces `before`; the page <img> points at it.
    const announced = (await getLogoVersions(env)).onLight;
    expect(announced).toBe(before);
    const res = await get("on-light", announced!);
    // R2 object was already overwritten (customMetadata.v = new) => 404 on every public page.
    expect(res.status).toBe(200);
  });

  it("two concurrent uploads for one slot must never end with pointer != object", async () => {
    const a = bytes(svg('<path d="M0 0h1v1z"/>'));
    const b = bytes(svg('<path d="M0 0h2v2z"/>'));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const slowFirst = {
      ...env,
      DB: flakyDb(async (sql) => {
        if (isSettingsWrite(sql) && first) {
          first = false;
          await gate; // A's pointer write lands AFTER B's
        }
      }),
    } as unknown as Env;
    const pa = saveLogo(slowFirst, "on-light", a);
    await new Promise((r) => setTimeout(r, 50)); // A put its R2 object
    await saveLogo(env, "on-light", b); // B: R2 + pointer
    release();
    await pa; // A's stale pointer overwrites B's
    const v = (await getLogoVersions(env)).onLight!;
    expect((await get("on-light", v)).status).toBe(200);
  });
});

describe("adversarial: SVG validator", () => {
  it("rejects a <use> exponential-expansion bomb (10^8 renders from 200 bytes of ids)", () => {
    const lvl = (i: number) =>
      `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`;
    let inner = '<g id="l0"><rect width="1" height="1"/></g>';
    for (let i = 1; i <= 8; i++) inner += lvl(i);
    inner += '<use href="#l8"/>';
    const r = validateLogo(
      bytes(
        svg(
          `<defs>${inner}</defs>`
            .replace("<defs>", "<defs>")
            .replace("</defs>", "</defs>") + '<use href="#l8"/>',
        ),
      ),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects CSS image-set() with a remote URL (no url() token needed)", () => {
    const r = validateLogo(
      bytes(
        svg(
          '<rect width="1" height="1" style="background-image:image-set(\'https://evil.example/t.png\' 1x)"/>',
        ),
      ),
    );
    expect(r.ok).toBe(false);
  });

  it('accepts a typical Illustrator export: <style type="text/css">', () => {
    const r = validateLogo(
      bytes(
        svg(
          '<style type="text/css">.st0{fill:#000000;}</style><path class="st0" d="M0 0h10v10z"/>',
        ),
      ),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects an SVG without the SVG namespace (browsers will not render it as an image)", () => {
    const r = validateLogo(
      bytes('<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>'),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects leading NBSP before <svg> (not well-formed XML, image breaks)", () => {
    const r = validateLogo(bytes([0xc2, 0xa0], svg()));
    expect(r.ok).toBe(false);
  });
});

describe("adversarial: raster validation is only magic bytes", () => {
  it("rejects a JPEG whose body is HTML between SOI and EOI", () => {
    const r = validateLogo(
      bytes(
        [0xff, 0xd8, 0xff, 0xe0],
        "<html><script>alert(1)</script>",
        [0xff, 0xd9],
      ),
    );
    expect(r.ok).toBe(false);
  });
  it("rejects a PNG declaring 16384x16384 in a few bytes (decode bomb)", () => {
    const u32 = (n: number) => [
      (n >>> 24) & 255,
      (n >>> 16) & 255,
      (n >>> 8) & 255,
      n & 255,
    ];
    const ch = (t: string, d: number[]) =>
      bytes(u32(d.length), t, d, [0, 0, 0, 0]);
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      ch("IHDR", [...u32(16384), ...u32(16384), 8, 6, 0, 0, 0]),
      ch("IDAT", [0x78, 0x9c, 0x63, 0, 1]),
      ch("IEND", []),
    );
    expect(validateLogo(png).ok).toBe(false);
  });
});
