/**
 * Photo versions, shared helpers (T6.53b/c). `photo_versions.drive_versions`
 * is the same JSON as `photos.variant_versions` (each variant's Drive
 * modified time); a version whose file left Drive also carries `missingSince`
 * until the sync's grace period deletes the row. Readers must ignore such rows.
 */
export const parseVersions = (json: string | null): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(json ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const missingSinceOf = (json: string | null): string | null => {
  const v = parseVersions(json).missingSince;
  return typeof v === "string" ? v : null;
};

export const markMissing = (json: string | null, since: string) =>
  JSON.stringify({ ...parseVersions(json), missingSince: since });
