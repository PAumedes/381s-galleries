import { GALLERY_MODES, GALLERY_STATUSES } from "../lib/constants";
import { sql } from "drizzle-orm";

import { COVER_LAYOUTS, GRID_GAPS, GRID_STYLES, PALETTES } from "../lib/design";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// NOTE: drizzle-kit does not manage triggers. The cover_photo_id same-gallery
// triggers live in migrations/0000_init.sql (appended after generation).
// Re-append them whenever the migration is regenerated.

// Timestamp convention: every timestamp column is an ISO 8601 UTC string
// `YYYY-MM-DDTHH:MM:SSZ`. DB defaults use strftime('%Y-%m-%dT%H:%M:%SZ','now');
// app code uses nowIso() (app/db/index.ts). Both sort lexicographically
// and compare correctly with each other at second precision.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ','now'))`);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const galleries = sqliteTable(
  "galleries",
  {
    id: id(),
    driveFolderId: text("drive_folder_id").notNull().unique(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    clientName: text("client_name"),
    eventDate: text("event_date"),
    pinHash: text("pin_hash"),
    expiresAt: text("expires_at"),
    status: text("status", { enum: GALLERY_STATUSES })
      .notNull()
      .default("draft"),
    coverPhotoId: text("cover_photo_id"),
    /** Cover focal point, percent 0-100 (object-position); null = centered. */
    coverFocusX: real("cover_focus_x"),
    coverFocusY: real("cover_focus_y"),
    // Optional per-device cover (0017): used on narrow viewports. Same rules
    // as the desktop one (same-gallery triggers, CHECK 0-100); null = the
    // desktop cover with its own focal point.
    coverPhotoIdMobile: text("cover_photo_id_mobile"),
    coverFocusMobileX: real("cover_focus_mobile_x"),
    coverFocusMobileY: real("cover_focus_mobile_y"),
    allowHighres: integer("allow_highres", { mode: "boolean" })
      .notNull()
      .default(true),
    allowWeb: integer("allow_web", { mode: "boolean" }).notNull().default(true),
    allowIg: integer("allow_ig", { mode: "boolean" }).notNull().default(true),
    allowBulk: integer("allow_bulk", { mode: "boolean" })
      .notNull()
      .default(true),
    requireEmail: integer("require_email", { mode: "boolean" })
      .notNull()
      .default(true),
    // Legacy (pre-0013): replaced by `mode`. Kept to avoid a table rebuild;
    // nothing reads or writes it any more.
    useWatermarkPreview: integer("use_watermark_preview", { mode: "boolean" })
      .notNull()
      .default(false),
    // 'proofing' (Prueba): every public image watermarked, downloads refused.
    // 'delivery' (Entrega): clean images, downloads per allow_* flags.
    mode: text("mode", { enum: GALLERY_MODES }).notNull().default("delivery"),
    // Legacy (0010, replaced by `palette` in 0015): kept to avoid rebuilding
    // the table (its CHECK cannot be altered and FKs cascade from it); nothing
    // reads or writes it any more.
    theme: text("theme", { enum: ["light", "dark"] })
      .notNull()
      .default("light"),
    // Client design (T6.5, §5.8). Enums are also CHECKed in D1 (0015).
    palette: text("palette", { enum: PALETTES }).notNull().default("claro"),
    coverLayout: text("cover_layout", { enum: COVER_LAYOUTS })
      .notNull()
      .default("completa"),
    gridStyle: text("grid_style", { enum: GRID_STYLES })
      .notNull()
      .default("filas"),
    gridGap: text("grid_gap", { enum: GRID_GAPS }).notNull().default("normal"),
    driveModifiedAt: text("drive_modified_at"),
    lastSyncedAt: text("last_synced_at"),
    syncIssuesJson: text("sync_issues_json"),
    // Sync safety (T1.3): set when the Drive folder is first seen missing;
    // the gallery is archived only after a grace period. When sync archives,
    // the previous status is kept here so it can be restored if the folder
    // comes back.
    folderMissingSince: text("folder_missing_since"),
    archivedPrevStatus: text("archived_prev_status", {
      enum: ["draft", "published"],
    }),
    // 1 only when sync (not an admin) archived the gallery: only those are
    // restored automatically when the folder reappears.
    archivedBySync: integer("archived_by_sync", { mode: "boolean" })
      .notNull()
      .default(false),
    // Public portfolio home (T6.6): "Mostrar en la portada". The 0/1 CHECK lives
    // in migration 0016; the home query also needs published, unexpired, no PIN.
    showOnHome: integer("show_on_home", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [
    // Case-insensitive: "Boda-Ana" and "boda-ana" are the same URL.
    uniqueIndex("galleries_slug_nocase_unique").on(
      sql`${t.slug} COLLATE NOCASE`,
    ),
    check("galleries_slug_nonempty_check", sql`length(${t.slug}) > 0`),
    ...(
      [
        ["allow_highres", t.allowHighres],
        ["allow_web", t.allowWeb],
        ["allow_ig", t.allowIg],
        ["allow_bulk", t.allowBulk],
        ["require_email", t.requireEmail],
        ["use_watermark_preview", t.useWatermarkPreview],
      ] as const
    ).map(([n, c]) => check(`galleries_${n}_bool_check`, sql`${c} IN (0,1)`)),
    check("galleries_mode_check", sql`${t.mode} IN ('proofing','delivery')`),
    check(
      "galleries_status_check",
      sql`${t.status} IN ('draft','published','archived')`,
    ),
  ],
);

export const photos = sqliteTable(
  "photos",
  {
    id: id(),
    galleryId: text("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    setName: text("set_name").notNull().default("Highlights"),
    baseName: text("base_name").notNull(),
    driveHighresId: text("drive_highres_id").notNull(),
    driveWebId: text("drive_web_id"),
    driveIgId: text("drive_ig_id"),
    driveThumbId: text("drive_thumb_id"),
    driveWmId: text("drive_wm_id"),
    // Optional 600px watermarked thumb (recipe `thumb-wm`): proofing grid.
    driveThumbWmId: text("drive_thumb_wm_id"),
    highresBytes: integer("highres_bytes"),
    // JSON {highres,web,ig,thumb,wm,thumbWm}: each variant's Drive modifiedTime (cache validation).
    variantVersions: text("variant_versions"),
    width: integer("width"),
    height: integer("height"),
    takenAt: text("taken_at"),
    sort: integer("sort").notNull().default(0),
    // Set when sync first sees the photo's high-res file missing; hard-deleted
    // only after a grace period. Client queries MUST filter `missing_since IS NULL`.
    missingSince: text("missing_since"),
    // Hash of the versions last warmed into R2 (thumb + view-sm); see warm.ts.
    cacheWarmKey: text("cache_warm_key"),
    // What cache_warm_key must equal for the photo to count as warmed. NULL =
    // unknown (computed lazily by warm.ts); DB triggers null it on any change.
    cacheExpectedKey: text("cache_expected_key"),
    // Per-photo failure back-off (warm.ts); triggers reset it on changes.
    cacheWarmFailCount: integer("cache_warm_fail_count").notNull().default(0),
    cacheWarmRetryAt: text("cache_warm_retry_at"),
  },
  (t) => [
    // Target for favorites' composite FK (same-gallery guarantee).
    unique("photos_gallery_id_id_unique").on(t.galleryId, t.id),
    unique("photos_gallery_set_base_unique").on(
      t.galleryId,
      t.setName,
      t.baseName,
    ),
    index("photos_gallery_set_sort_idx").on(t.galleryId, t.setName, t.sort),
  ],
);

export const visitors = sqliteTable(
  "visitors",
  {
    id: id(),
    galleryId: text("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    firstSeen: text("first_seen")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ','now'))`),
  },
  (t) => [
    // Target for favorites' composite FK (same-gallery guarantee).
    unique("visitors_gallery_id_id_unique").on(t.galleryId, t.id),
    // Per-device visitors (PLAN 5.4): the same email may appear on several
    // rows, so this is a plain lookup index. App code trims + lowercases emails.
    index("visitors_gallery_email_nocase_idx").on(
      t.galleryId,
      sql`${t.email} COLLATE NOCASE`,
    ),
  ],
);

export const favorites = sqliteTable(
  "favorites",
  {
    galleryId: text("gallery_id").notNull(),
    visitorId: text("visitor_id").notNull(),
    photoId: text("photo_id").notNull(),
    listName: text("list_name").notNull().default("Favoritos"),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.visitorId, t.photoId, t.listName] }),
    index("favorites_gallery_visitor_idx").on(t.galleryId, t.visitorId),
    // Composite FKs: visitor and photo must both belong to gallery_id.
    foreignKey({
      columns: [t.galleryId, t.visitorId],
      foreignColumns: [visitors.galleryId, visitors.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.galleryId, t.photoId],
      foreignColumns: [photos.galleryId, photos.id],
    }).onDelete("cascade"),
  ],
);

// Stats tables have no FKs: deleteGallery (gallery-delete.ts) removes their rows explicitly.
/**
 * What we learn about a visitor's request (0018_visitor_data). Never the raw
 * IP: `ip_hash` is a keyed one-way hash. All nullable; the length / enum
 * CHECKs live in the migration (column-level, like 0014/0017).
 */
const visitorColumns = () => ({
  region: text("region"),
  city: text("city"),
  continent: text("continent"),
  timezone: text("timezone"),
  asn: integer("asn"),
  asOrg: text("as_org"),
  lang: text("lang"),
  referrerHost: text("referrer_host"),
  browser: text("browser"),
  browserVersion: text("browser_version"),
  os: text("os"),
  device: text("device", {
    enum: ["mobile", "tablet", "desktop", "bot", "unknown"],
  }),
});

export const downloads = sqliteTable(
  "downloads",
  {
    id: id(),
    galleryId: text("gallery_id").notNull(),
    photoId: text("photo_id"),
    visitorId: text("visitor_id"),
    variant: text("variant", { enum: ["highres", "web", "ig"] }).notNull(),
    kind: text("kind", { enum: ["single", "bulk"] }).notNull(),
    /** Download token id (jti): a retried/resumed token logs only once. */
    tokenId: text("token_id"),
    /** Per-photo rows of a bulk run: the header row's id (null for single downloads and "multi" tokens). */
    bulkId: text("bulk_id"),
    /** Bulk header rows only: `all`, `favorites` or `set:<name>`. */
    bulkScope: text("bulk_scope"),
    country: text("country"),
    ua: text("ua"),
    ipHash: text("ip_hash"),
    ...visitorColumns(),
    createdAt: createdAt(),
  },
  (t) => [
    index("downloads_gallery_created_idx").on(t.galleryId, t.createdAt),
    index("downloads_gallery_bulk_idx").on(t.galleryId, t.bulkId),
    uniqueIndex("downloads_token_id_idx").on(t.tokenId),
    check(
      "downloads_variant_check",
      sql`${t.variant} IN ('highres','web','ig')`,
    ),
    check("downloads_kind_check", sql`${t.kind} IN ('single','bulk')`),
  ],
);

export const galleryViews = sqliteTable(
  "gallery_views",
  {
    galleryId: text("gallery_id").notNull(),
    visitorId: text("visitor_id"),
    country: text("country"),
    ipHash: text("ip_hash"),
    ...visitorColumns(),
    createdAt: createdAt(),
  },
  (t) => [
    index("gallery_views_gallery_created_idx").on(t.galleryId, t.createdAt),
    index("gallery_views_dedupe_idx").on(t.galleryId, t.ipHash, t.createdAt),
  ],
);

/** Generic fixed-window rate limiter (see `rateLimit`): key = `<scope>:<key>`, e.g. `pin:<ip_hash>:<gallery_id>`. */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: text("window_start").notNull(),
});

/**
 * Tombstones of deleted galleries (0019): ONLY the Drive folder id and when it
 * was deleted, so sync does not re-create the gallery. See gallery-delete.ts.
 */
export const ignoredFolders = sqliteTable("ignored_folders", {
  driveFolderId: text("drive_folder_id").primaryKey(),
  deletedAt: text("deleted_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ','now'))`),
});

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type Gallery = typeof galleries.$inferSelect;
export type NewGallery = typeof galleries.$inferInsert;
export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;
export type Visitor = typeof visitors.$inferSelect;
export type NewVisitor = typeof visitors.$inferInsert;
export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;
export type Download = typeof downloads.$inferSelect;
export type NewDownload = typeof downloads.$inferInsert;
export type GalleryView = typeof galleryViews.$inferSelect;
export type NewGalleryView = typeof galleryViews.$inferInsert;
