import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../../db";
import { anonLabel, namesTxt } from "../../admin-activity";
import { allMessages } from "../../../i18n/dictionaries";
import { DEFAULT_LANG, type Lang } from "../../../i18n/lang";
import { makeT } from "../../../i18n/t";
import { isAnon } from "../access";
import { adminHeaders } from "../admin";
import { loadGallery } from "./shared";

export interface FavPhoto {
  id: string;
  name: string;
  set: string;
  /** Photo in its sync grace period (hidden from clients, gone for Capture One). */
  hidden: boolean;
}

async function favoriteRows(env: Env, galleryId: string) {
  return getDb(env)
    .select({
      visitorId: schema.favorites.visitorId,
      email: schema.visitors.email,
      listName: schema.favorites.listName,
      createdAt: schema.favorites.createdAt,
      photoId: schema.photos.id,
      name: schema.photos.baseName,
      set: schema.photos.setName,
      visible: sql<number>`(${photoVisible})`,
    })
    .from(schema.favorites)
    .innerJoin(
      schema.visitors,
      and(
        eq(schema.visitors.id, schema.favorites.visitorId),
        eq(schema.visitors.galleryId, schema.favorites.galleryId),
      ),
    )
    .innerJoin(
      schema.photos,
      and(
        eq(schema.photos.id, schema.favorites.photoId),
        eq(schema.photos.galleryId, schema.favorites.galleryId),
      ),
    )
    .where(eq(schema.favorites.galleryId, galleryId))
    .orderBy(
      asc(schema.photos.setName),
      asc(schema.photos.sort),
      asc(schema.photos.baseName),
    );
}

type FavRow = Awaited<ReturnType<typeof favoriteRows>>[number];
type FavPerson = {
  id: string;
  label: string;
  anon: boolean;
  lists: Map<string, { name: string; last: string; photos: FavPhoto[] }>;
};

/** Rows grouped per person (lowercased email; one per device when anonymous) and per picked photo. */
function groupFavoriteRows(rows: FavRow[]) {
  const by = new Map<string, FavPerson>();
  const picks = new Map<string, { photo: FavPhoto; visitors: Set<string> }>();
  for (const r of rows) {
    const anon = isAnon(r.email);
    // Per-device visitors: one person per (lowercased) email in admin.
    const person = anon ? r.visitorId : r.email.toLowerCase();
    let v = by.get(person);
    if (!v) {
      v = {
        id: person,
        label: anon ? anonLabel(r.visitorId) : r.email,
        anon,
        lists: new Map(),
      };
      by.set(person, v);
    }
    let l = v.lists.get(r.listName);
    if (!l) {
      l = { name: r.listName, last: r.createdAt, photos: [] };
      v.lists.set(r.listName, l);
    }
    if (r.createdAt > l.last) l.last = r.createdAt;
    const photo: FavPhoto = {
      id: r.photoId,
      name: r.name,
      set: r.set,
      hidden: !r.visible,
    };
    // Two devices of one person favouriting the same photo is one pick.
    if (!l.photos.some((x) => x.id === photo.id)) l.photos.push(photo);
    const p = picks.get(r.photoId) ?? { photo, visitors: new Set() };
    p.visitors.add(person);
    picks.set(r.photoId, p);
  }
  return { by, picks };
}

function visitorsView(by: Map<string, FavPerson>) {
  return [...by.values()]
    .map((v) => ({
      id: v.id,
      label: v.label,
      anon: v.anon,
      lists: [...v.lists.values()]
        .map((l) => ({
          name: l.name,
          count: l.photos.length,
          last: l.last,
          photos: l.photos,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, "es", { sensitivity: "base" }),
    );
}

/** Every picked photo with how many people picked it, most picked first. */
function picksView(
  picks: Map<string, { photo: FavPhoto; visitors: Set<string> }>,
) {
  return [...picks.values()]
    .map((p) => ({ ...p.photo, picks: p.visitors.size }))
    .sort((a, b) => b.picks - a.picks || a.name.localeCompare(b.name, "es"));
}

export async function loadFavoritesAdmin(env: Env, id: string) {
  const g = await loadGallery(env, id);
  if (!g) return null;
  const { by, picks } = groupFavoriteRows(await favoriteRows(env, id));
  return { gallery: g, visitors: visitorsView(by), all: picksView(picks) };
}

/** `.txt` for Capture One: one base name per line, existing photos only. Null = unknown gallery/visitor. */
export async function favoritesTxt(
  env: Env,
  id: string,
  visitorId: string | null,
  lang: Lang = DEFAULT_LANG,
): Promise<Response | null> {
  const g = await loadGallery(env, id);
  if (!g) return null;
  const t = makeT(lang, allMessages(lang));
  let rows = await favoriteRows(env, id);
  if (visitorId) {
    // `visitorId` is a person key: an anonymous visitor id or a (lowercased) email.
    const key = visitorId.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.visitorId === visitorId ||
        (!isAnon(r.email) && r.email.toLowerCase() === key),
    );
    if (rows.length === 0) return null;
  }
  const names = [...new Set(rows.filter((r) => r.visible).map((r) => r.name))];
  const suffix = visitorId
    ? `-${visitorId.slice(0, 8).replace(/[^\w-]/g, "")}`
    : "";
  return new Response(namesTxt(names), {
    headers: {
      ...adminHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${g.slug}-${t("admin.export.file.favorites")}${suffix}.txt"`,
    },
  });
}
