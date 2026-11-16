/** Reserved URL slugs (PLAN section 2): a gallery never gets one of these. */
export const RESERVED_SLUGS: readonly string[] = [
  "admin",
  "api",
  "img",
  "dl",
  "assets",
  "brand",
  "favicon.ico",
  "robots.txt",
  "manifest.webmanifest",
];

const SLUG_MAX = 60;

export function slugify(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  return s || "galeria";
}

/** Slug for `name` that is neither reserved nor in `taken`; adds it to `taken`. */
export function uniqueSlug(name: string, taken: Set<string>): string {
  const base = slugify(name);
  let slug = base;
  for (let n = 2; taken.has(slug) || RESERVED_SLUGS.includes(slug); n++) {
    const suffix = `-${n}`;
    slug = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "") + suffix;
  }
  taken.add(slug);
  return slug;
}
