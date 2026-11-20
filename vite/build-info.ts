import { execFileSync } from "node:child_process";
import path from "node:path";

export interface ResolvedBuildInfo {
  sha: string;
  date: string;
}

const HEX = /^[0-9a-f]{7,40}$/i;
const SHORT = 7;

export function gitShortSha(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", `--short=${SHORT}`, "HEAD"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/** CI sha (GITHUB_SHA), else local git, else "dev" (forks/tarballs without git). */
export function resolveBuildInfo(
  env: Record<string, string | undefined>,
  git: () => string | undefined = gitShortSha,
  now: Date = new Date(),
): ResolvedBuildInfo {
  let raw: string | undefined;
  if (env.GITHUB_SHA && HEX.test(env.GITHUB_SHA)) raw = env.GITHUB_SHA;
  else {
    try {
      raw = git();
    } catch {
      raw = undefined;
    }
  }
  const sha = raw && HEX.test(raw) ? raw.slice(0, SHORT).toLowerCase() : "dev";
  return { sha, date: now.toISOString() };
}

/** SOURCE_DATE_EPOCH (seconds) when valid, else the current time. */
function buildTime(env: Record<string, string | undefined>): Date | undefined {
  const raw = env.SOURCE_DATE_EPOCH;
  if (!raw || !/^\d{1,12}$/.test(raw)) return undefined;
  return new Date(Number(raw) * 1000);
}

export function buildInfoDefine(
  env: Record<string, string | undefined> = process.env,
) {
  const epoch = buildTime(env);
  const b = resolveBuildInfo(env, gitShortSha, epoch);
  // Without a fixed epoch embed only the day, so two builds of the same
  // commit on the same day are byte-identical.
  const date = epoch ? b.date : b.date.slice(0, 10);
  return {
    __BUILD_SHA__: JSON.stringify(b.sha),
    __BUILD_DATE__: JSON.stringify(date),
  };
}
