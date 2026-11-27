/** Test doubles for the R2 cache bucket (orphan sweep tests). */
export const VARIANTS = ["thumb", "view-sm", "view-lg"];
export const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** An in-memory bucket with real list semantics (sorted, cursor, limit) to test 5000+ keys cheaply. */
export function fakeBucket(n: number, uploaded = new Date(0)) {
  const all = Array.from(
    { length: n },
    (_, i) => `${uuid(Math.floor(i / 3))}/${VARIANTS[i % 3]}`,
  ).sort();
  const live = new Set(all);
  const calls = { list: 0, delete: 0 };
  const bucket = {
    list: async (o: { cursor?: string; limit?: number } = {}) => {
      calls.list++;
      const sorted = [...live].sort();
      const start = o.cursor ? sorted.findIndex((k) => k > o.cursor!) : 0;
      const slice =
        start < 0 ? [] : sorted.slice(start, start + (o.limit ?? 1000));
      const truncated = start >= 0 && start + slice.length < sorted.length;
      return {
        objects: slice.map((key) => ({ key, size: 10, uploaded })),
        truncated,
        cursor: truncated ? slice[slice.length - 1] : undefined,
      };
    },
    delete: async (k: string | string[]) => {
      calls.delete++;
      for (const key of Array.isArray(k) ? k : [k]) live.delete(key);
    },
  };
  return {
    bucket: bucket as unknown as Pick<R2Bucket, "list" | "delete">,
    live,
    calls,
  };
}
