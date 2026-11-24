/** The cron's per-photo warm marker: expected key and "this photo is warmed". */
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { resolveSource } from "./images";
import type { SourcePhoto, Variant } from "./images";

export const WARM_VARIANTS: readonly Variant[] = ["thumb", "view-sm"];
/** Hash of what a fully warmed `photo` looks like (16 hex chars). */
export async function expectedWarmKey(
  photo: SourcePhoto,
  proofing: boolean,
): Promise<string> {
  const parts = WARM_VARIANTS.map((v) => {
    const s = resolveSource(photo, proofing, v);
    return s
      ? `${v}|${s.fileId}|${s.watermark ? 1 : 0}|${s.version}`
      : v + "|-";
  });
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.join("\n")),
  );
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

const P = schema.photos;

/**
 * Sets the cron's marker for a photo whose thumb and view-sm were just
 * verified in R2 (same key semantics). A row whose stored expected key
 * differs (a re-export or mode switch raced us) is left for the cron.
 */
export async function markWarmed(
  env: Env,
  photo: SourcePhoto,
  proofing: boolean,
): Promise<void> {
  const key = await expectedWarmKey(photo, proofing);
  await getDb(env)
    .update(P)
    .set({
      cacheExpectedKey: key,
      cacheWarmKey: key,
      cacheWarmFailCount: 0,
      cacheWarmRetryAt: null,
    })
    .where(
      and(
        eq(P.id, photo.id),
        or(isNull(P.cacheExpectedKey), eq(P.cacheExpectedKey, key)),
      ),
    );
}
