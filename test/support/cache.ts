import { env } from "cloudflare:workers";

/** Delete every object in the test R2 cache bucket (all pages). */
export async function clearCache(): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.CACHE.list({ cursor });
    if (page.objects.length > 0)
      await env.CACHE.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
