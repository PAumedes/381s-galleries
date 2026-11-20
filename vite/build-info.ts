import { execFileSync } from "node:child_process";

export interface ResolvedBuildInfo {
  sha: string;
  date: string;
}

const HEX = /^[0-9a-f]{7,40}$/i;
const SHORT = 7;

export function gitShortSha(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", `--short=${SHORT}`, "HEAD"], {
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
  let sha: string | undefined;
  if (env.GITHUB_SHA && HEX.test(env.GITHUB_SHA))
    sha = env.GITHUB_SHA.slice(0, SHORT).toLowerCase();
  else {
    try {
      sha = git();
    } catch {
      sha = undefined;
    }
  }
  return { sha: sha && HEX.test(sha) ? sha : "dev", date: now.toISOString() };
}

export function buildInfoDefine(
  env: Record<string, string | undefined> = process.env,
) {
  const b = resolveBuildInfo(env);
  return {
    __BUILD_SHA__: JSON.stringify(b.sha),
    __BUILD_DATE__: JSON.stringify(b.date),
  };
}
