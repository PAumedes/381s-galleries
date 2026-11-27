import { describe, expect, it } from "vitest";
import { classifyCacheKey } from "../app/lib/server/orphan-sweep";
import { cacheKey } from "../app/lib/server/image-source";

/** T6.59: the strict allow-list. Anything that does not match is never touched. */
const A = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("T6.59 classifyCacheKey: keys the app writes", () => {
  it.each(["thumb", "view-sm", "view-lg"] as const)("v1 %s", (v) => {
    expect(classifyCacheKey(`${A}/${v}`)).toEqual({
      photoId: A,
      version: 1,
      variant: v,
    });
  });

  it.each([2, 3, 9, 10, 99, 100, 999])("v%i", (n) => {
    expect(classifyCacheKey(`${A}/v${n}/view-lg`)).toEqual({
      photoId: A,
      version: n,
      variant: "view-lg",
    });
  });

  it("accepts exactly what cacheKey() writes (no drift)", () => {
    for (const version of [undefined, 1, 2, 7, 999])
      for (const variant of ["thumb", "view-sm", "view-lg"] as const)
        expect(classifyCacheKey(cacheKey({ id: A, version }, variant))).toEqual(
          { photoId: A, version: version ?? 1, variant },
        );
  });

  it("A/v2 and A/v20 are different versions", () => {
    expect(classifyCacheKey(`${A}/v2/thumb`)?.version).toBe(2);
    expect(classifyCacheKey(`${A}/v20/thumb`)?.version).toBe(20);
  });
});

describe("T6.59 classifyCacheKey: everything else is ignored (null)", () => {
  const bad: [string, string][] = [
    ["empty", ""],
    ["uuid only", A],
    ["uuid and slash", `${A}/`],
    ["unknown variant", `${A}/original`],
    ["variant prefix", `${A}/thumb2`],
    ["variant suffix", `${A}/xthumb`],
    ["variant case", `${A}/THUMB`],
    ["uppercase uuid", `${A.toUpperCase()}/thumb`],
    ["short uuid", `${A.slice(1)}/thumb`],
    ["long uuid", `0${A}/thumb`],
    ["not hex uuid", "zzzzzzzz-4e5f-4a6b-8c7d-9e0f1a2b3c4d/thumb"],
    ["uuid-like prefix with tail", `${A}-extra/thumb`],
    ["uuid-like with leading text", `x${A}/thumb`],
    ["leading slash", `/${A}/thumb`],
    ["double slash", `${A}//thumb`],
    ["trailing slash", `${A}/thumb/`],
    ["nested path", `x/${A}/thumb`],
    ["nested after", `${A}/thumb/extra`],
    ["nested version", `${A}/v2/x/thumb`],
    ["v1 spelled out (never written)", `${A}/v1/thumb`],
    ["v0", `${A}/v0/thumb`],
    ["v1000", `${A}/v1000/thumb`],
    ["leading zero version", `${A}/v02/thumb`],
    ["signed version", `${A}/v+2/thumb`],
    ["uppercase V", `${A}/V2/thumb`],
    ["version without number", `${A}/v/thumb`],
    ["version with text", `${A}/v2a/thumb`],
    ["version with spaces", `${A}/v 2/thumb`],
    ["dotdot", `${A}/../thumb`],
    ["newline", `${A}/thumb\n`],
    ["nul byte", `${A}/thumb\0`],
    ["query", `${A}/thumb?x=1`],
    ["encoded slash", `${A}%2Fthumb`],
    ["studio logo", "brand/logo-light"],
    ["a folder", "backups/2026/db.sql"],
    ["two uuids", `${A}/${A}`],
  ];
  it.each(bad)("%s", (_name, key) => {
    expect(classifyCacheKey(key)).toBeNull();
  });
});
