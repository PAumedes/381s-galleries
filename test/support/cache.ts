import { env } from "cloudflare:workers";

/** Delete every object in the test R2 cache bucket. */
export async function clearCache(): Promise<void> {
  for (const o of (await env.CACHE.list()).objects)
    await env.CACHE.delete(o.key);
}
