import { requireAdmin } from "./auth";

/**
 * Admin-only JavaScript lives under this prefix (see vite/admin-chunks.ts) and
 * is listed in `assets.run_worker_first`, so Workers Static Assets hands those
 * requests to the Worker instead of serving them publicly.
 */
export const ADMIN_ASSET_PREFIX = "/admin-assets/";

// One flat, content-hashed file name: no dot-files, no "..", no slashes, no
// percent-escapes, nothing but the characters Rollup emits.
const SAFE_NAME = /^\/admin-assets\/[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const CONDITIONAL = ["If-None-Match", "If-Modified-Since"];

type AssetEnv = Parameters<typeof requireAdmin>[1] & { ASSETS: Fetcher };

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
  });

/**
 * Serves `/admin-assets/*` from the assets binding to the verified admin only.
 * Returns null for any other path (the caller continues normally). Everyone
 * else gets the same bare 404, so nothing reveals what exists. The binding is
 * only ever asked for a path that passed SAFE_NAME.
 */
export async function adminAssetResponse(
  request: Request,
  env: AssetEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  // Case-insensitive on purpose: a variant must never fall through to a
  // different handler, it gets the same 404 as everything else.
  if (!url.pathname.toLowerCase().startsWith(ADMIN_ASSET_PREFIX)) return null;

  try {
    await requireAdmin(request, env);
  } catch {
    return notFound();
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });
  }
  if (!SAFE_NAME.test(url.pathname) || url.pathname.includes("..")) {
    return notFound();
  }

  const headers = new Headers();
  for (const name of CONDITIONAL) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }
  const upstream = await env.ASSETS.fetch(
    new Request(`${url.origin}${url.pathname}`, {
      method: request.method,
      headers,
      redirect: "manual",
    }),
  );
  if (upstream.status !== 200 && upstream.status !== 304) {
    void upstream.body?.cancel();
    return notFound();
  }
  const out = new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
  // File names are content-hashed; `private` keeps shared caches away.
  out.headers.set("Cache-Control", "private, max-age=31536000, immutable");
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("X-Robots-Tag", "noindex");
  return out;
}
