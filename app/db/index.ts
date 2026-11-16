import { drizzle } from "drizzle-orm/d1";
import { isNull } from "drizzle-orm";
import * as schema from "./schema";

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
export { schema };

/** `date` (default: now) as ISO 8601 UTC at second precision: `YYYY-MM-DDTHH:MM:SSZ`. */
export function nowIso(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Predicate for every client-facing photo query: hides photos in their sync
 * grace period (`missing_since` set). Use `.where(and(..., photoVisible))`.
 */
export const photoVisible = isNull(schema.photos.missingSince);
