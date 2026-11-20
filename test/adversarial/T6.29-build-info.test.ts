import { describe, expect, it } from "vitest";
import { formatBuildId } from "../../app/lib/build-info";
import { buildInfoDefine, resolveBuildInfo } from "../../vite/build-info";

const now = new Date("2026-11-20T10:00:00Z");

describe("T6.29 adversarial", () => {
  it("git path is normalised like the GITHUB_SHA path (7 chars, lowercase)", () => {
    const full = "ABCDEF1234567890ABCDEF1234567890ABCDEF12";
    const viaCi = resolveBuildInfo({ GITHUB_SHA: full }, () => undefined, now);
    const viaGit = resolveBuildInfo({}, () => full, now);
    expect(viaGit.sha).toBe(viaCi.sha);
  });

  it("git short sha with 8+ chars (ambiguity) is truncated to 7", () => {
    expect(resolveBuildInfo({}, () => "abcdef123", now).sha).toHaveLength(7);
  });

  it("build date honours SOURCE_DATE_EPOCH (reproducible builds)", () => {
    const d = buildInfoDefine({
      GITHUB_SHA: "abcdef1234",
      SOURCE_DATE_EPOCH: "1700000000",
    });
    expect(JSON.parse(d.__BUILD_DATE__)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("formatBuildId rejects impossible dates", () => {
    expect(formatBuildId("abc1234", "2026-99-99T00:00:00Z").date).toBeNull();
  });

  it("formatBuildId shows a 40-char sha only as a short one", () => {
    expect(
      formatBuildId("a".repeat(40), "2026-11-20T00:00:00Z").sha.length,
    ).toBeLessThanOrEqual(7);
  });

  it("date shown is the UTC day even for Date ISO near midnight (stable)", () => {
    expect(formatBuildId("abc1234", "2026-11-20T23:59:59.999Z").date).toBe(
      "2026-11-20",
    );
  });
});
