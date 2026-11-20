import { describe, expect, it } from "vitest";
import { formatBuildId, readBuildInfo } from "../app/lib/build-info";
import { resolveBuildInfo } from "../vite/build-info";

describe("T6.29 formatBuildId", () => {
  it("shows short sha and date", () => {
    expect(formatBuildId("abc1234", "2026-11-20T15:04:05.000Z")).toEqual({
      sha: "abc1234",
      date: "2026-11-20",
    });
  });
  it("falls back to dev and no date when missing or malformed", () => {
    expect(formatBuildId(undefined, undefined)).toEqual({
      sha: "dev",
      date: null,
    });
    expect(formatBuildId("", "garbage")).toEqual({ sha: "dev", date: null });
    expect(formatBuildId("<script>", "2026-11-20T00:00:00Z").sha).toBe("dev");
  });
  it("readBuildInfo works without the build-time defines (tests, dev)", () => {
    expect(readBuildInfo().sha).toBe("dev");
  });
});

describe("T6.29 resolveBuildInfo (vite)", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  it("prefers GITHUB_SHA (7 chars), then git, then dev", () => {
    const a = resolveBuildInfo(
      { GITHUB_SHA: "0123456789abcdef" },
      () => "zzz",
      now,
    );
    expect(a.sha).toBe("0123456");
    expect(resolveBuildInfo({}, () => "fedcba9", now).sha).toBe("fedcba9");
    expect(resolveBuildInfo({}, () => undefined, now).sha).toBe("dev");
    expect(
      resolveBuildInfo(
        {},
        () => {
          throw new Error("no git");
        },
        now,
      ).sha,
    ).toBe("dev");
    expect(
      resolveBuildInfo({ GITHUB_SHA: "nothex!" }, () => undefined, now).sha,
    ).toBe("dev");
  });
  it("carries the build date as ISO", () => {
    expect(resolveBuildInfo({}, () => undefined, now).date).toBe(
      "2026-11-20T10:00:00.000Z",
    );
  });
});
