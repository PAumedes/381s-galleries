import { buildManifest } from "../pwa";
import { getStudioName } from "./admin";
import { isAvailable, type AccessEnv } from "./access";
import { findGalleryWithClient } from "./gallery-resolve";
import { NOSNIFF } from "./http";

const HEADERS = {
  "Content-Type": "application/manifest+json; charset=utf-8",
  "Cache-Control": "private, max-age=300",
  "X-Robots-Tag": "noindex, nofollow",
  ...NOSNIFF,
};

/**
 * Per-gallery web manifest. Same privacy rules as the Open Graph tags: only a
 * published, unexpired, PIN-less gallery exposes its title; a PIN one keeps the
 * generic name/icons but scopes to its slug (its page links this manifest);
 * draft, archived, expired and unknown get the identical generic manifest.
 */
export async function handleManifest(
  request: Request,
  slug: string,
  env: AccessEnv & { STUDIO_NAME: string },
): Promise<Response> {
  const studio = await getStudioName(env, request);
  const hit = slug.includes(".")
    ? undefined
    : await findGalleryWithClient(env, slug);
  const g = hit?.gallery;
  const gallery = isAvailable(g)
    ? {
        slug: g.slug,
        clientSlug: hit!.clientSlug,
        title: g.pinHash ? undefined : g.title,
        palette: g.palette,
      }
    : undefined;
  return new Response(JSON.stringify(buildManifest({ studio, gallery })), {
    headers: HEADERS,
  });
}

/** Generic studio manifest ("/manifest.webmanifest"): name from STUDIO_NAME/settings. */
export async function handleGenericManifest(
  request: Request,
  env: Pick<Env, "DB" | "STUDIO_NAME">,
): Promise<Response> {
  const studio = await getStudioName(env, request);
  return new Response(JSON.stringify(buildManifest({ studio })), {
    headers: HEADERS,
  });
}
