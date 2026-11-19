export type Route = { pattern: string; custom_domain: boolean };
export type HostConfig = {
  routes: Route[];
  vars: { PUBLIC_ORIGIN: string; LEGACY_HOSTS?: string; STUDIO_NAME: string };
};

/** Strip comments and trailing commas from JSONC, leaving strings untouched. */
export function stripJsonc(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') {
      let j = i + 1;
      while (j < raw.length && raw[j] !== '"') j += raw[j] === "\\" ? 2 : 1;
      out += raw.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && raw[i + 1] === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
    } else if (c === "/" && raw[i + 1] === "*") {
      const end = raw.indexOf("*/", i + 2);
      i = end < 0 ? raw.length : end + 2;
      out += " ";
    } else if (c === ",") {
      // trailing comma: next significant char (past whitespace/comments) closes
      let j = i + 1;
      for (;;) {
        while (j < raw.length && /\s/.test(raw[j])) j++;
        if (raw[j] === "/" && raw[j + 1] === "/") {
          while (j < raw.length && raw[j] !== "\n") j++;
        } else if (raw[j] === "/" && raw[j + 1] === "*") {
          const end = raw.indexOf("*/", j + 2);
          j = end < 0 ? raw.length : end + 2;
        } else break;
      }
      if (raw[j] !== "}" && raw[j] !== "]") out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export const parseWrangler = (raw: string): HostConfig =>
  JSON.parse(stripJsonc(raw));

const normHost = (h: string) => h.trim().toLowerCase().replace(/\.$/, "");

export const legacyHostsOf = (c: HostConfig) =>
  (c.vars.LEGACY_HOSTS ?? "").split(",").map(normHost).filter(Boolean);

/** Same rule as the runtime (validPublicOrigin) plus "origin only". */
function canonicalHost(origin: unknown): string | null {
  if (typeof origin !== "string") return null;
  try {
    const u = new URL(origin.trim());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.protocol !== "https:" && !(local && u.protocol === "http:"))
      return null;
    if (u.username || u.password) return null;
    if (origin.trim() !== u.origin) return null; // no path / trailing slash
    return normHost(u.host);
  } catch {
    return null;
  }
}

/** Structural problems of a wrangler host config (owner- and fork-agnostic). */
export function hostConfigProblems(c: HostConfig): string[] {
  const out: string[] = [];
  const canon = canonicalHost(c.vars.PUBLIC_ORIGIN);
  if (canon === null)
    out.push(
      "PUBLIC_ORIGIN must be an https origin without path (e.g. https://host)",
    );
  const legacy = legacyHostsOf(c);
  const domains = c.routes
    .filter((r) => r.custom_domain === true)
    .map((r) => normHost(r.pattern));
  if (domains.length !== c.routes.length)
    out.push("every route must be custom_domain: true");
  if (canon !== null && !domains.includes(canon))
    out.push("no route for the PUBLIC_ORIGIN host");
  const seen = new Set<string>();
  for (const h of legacy) {
    if (seen.has(h)) out.push(`duplicate legacy host: ${h}`);
    seen.add(h);
    if (h === canon) out.push(`legacy host equals canonical: ${h}`);
    if (!/^[a-z0-9.-]+$/.test(h) || h.includes("/"))
      out.push(`legacy host is not a hostname: ${h}`);
    if (!domains.includes(h)) out.push(`no route for legacy host ${h}`);
  }
  if (domains.length !== 1 + new Set(legacy).size)
    out.push("routes must be the canonical host plus each legacy host");
  if (typeof c.vars.STUDIO_NAME !== "string" || !c.vars.STUDIO_NAME.trim())
    out.push("STUDIO_NAME must be a non-empty string");
  return out;
}
