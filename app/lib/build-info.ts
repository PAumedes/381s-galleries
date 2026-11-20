// Build identifier shown in the admin settings footer. The values are
// injected at build time by vite/build-info.ts (Vite `define`); without them
// (tests, forks without git) the label is "dev". Nothing secret: a short
// commit hash and a date.
declare const __BUILD_SHA__: string | undefined;
declare const __BUILD_DATE__: string | undefined;

export interface BuildId {
  sha: string;
  date: string | null;
}

const SHA = /^[0-9a-f]{4,40}$/i;
const ISO_DAY = /^(\d{4}-\d{2}-\d{2})(?:T|$)/;

const SHORT_SHA = 7;

function validDay(iso?: string): string | null {
  const day = iso?.match(ISO_DAY)?.[1];
  return day && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? day : null;
}

export function formatBuildId(sha?: string, iso?: string): BuildId {
  return {
    sha: sha && SHA.test(sha) ? sha.slice(0, SHORT_SHA) : "dev",
    date: validDay(iso),
  };
}

export function readBuildInfo(): BuildId {
  return formatBuildId(
    typeof __BUILD_SHA__ === "undefined" ? undefined : __BUILD_SHA__,
    typeof __BUILD_DATE__ === "undefined" ? undefined : __BUILD_DATE__,
  );
}
