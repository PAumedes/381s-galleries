import { describe, expect, it } from "vitest";
import { assertDistinctSecrets } from "../app/lib/server/crypto";

const S = "s".repeat(10) + "ession-secret-0123456789-abcdefghij";
const D = "download-secret-0123456789-abcdefghijklmn";
const K = "yogTK+cwJid8noG4Vt0xD2UnRFi5DXpIYNqlDl+l0HE=";

describe("assertDistinctSecrets", () => {
  it("accepts three different secrets", () => {
    expect(() =>
      assertDistinctSecrets({
        SESSION_SECRET: S,
        DOWNLOAD_SECRET: D,
        TOKEN_KEY: K,
      }),
    ).not.toThrow();
  });
  it.each([
    [
      "SESSION_SECRET",
      "DOWNLOAD_SECRET",
      { SESSION_SECRET: S, DOWNLOAD_SECRET: S, TOKEN_KEY: K },
    ],
    [
      "SESSION_SECRET",
      "TOKEN_KEY",
      { SESSION_SECRET: K, DOWNLOAD_SECRET: D, TOKEN_KEY: K },
    ],
    [
      "DOWNLOAD_SECRET",
      "TOKEN_KEY",
      { SESSION_SECRET: S, DOWNLOAD_SECRET: K, TOKEN_KEY: K },
    ],
  ])("throws a clear error when %s equals %s", (a, b, env) => {
    expect(() => assertDistinctSecrets(env)).toThrow(
      new RegExp(`${a}.*${b}.*(differ|distinct)`),
    );
  });
  it("ignores surrounding whitespace when comparing", () => {
    expect(() =>
      assertDistinctSecrets({
        SESSION_SECRET: S,
        DOWNLOAD_SECRET: ` ${S} `,
        TOKEN_KEY: K,
      }),
    ).toThrow();
  });
});
