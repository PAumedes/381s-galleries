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
// Same for the slug-namespace triggers (migration 0020): a client slug and a
// gallery slug may never be equal (case-insensitive); see slug-namespace.ts.

// Timestamp convention: every timestamp column is an ISO 8601 UTC string
// `YYYY-MM-DDTHH:MM:SSZ`. DB defaults use strftime('%Y-%m-%dT%H:%M:%SZ','now');
// app code uses nowIso() (app/db/index.ts). Both sort lexicographically
// and compare correctly with each other at second precision.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = (column = "created_at") =>
  text(column)
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ','now'))`);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Client folders (T6.40, migration 0020). Slug shares the gallery URL namespace
// (SQL triggers in 0020, not modelled here). default_mode/default_show_on_home
// are copied onto an album when it is assigned (not live-inherited).
export const clients = sqliteTable(
  "clients",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    defaultMode: text("default_mode", { enum: GALLERY_MODES })
      .notNull()
      .default("proofing"),
    defaultShowOnHome: integer("default_show_on_home", { mode: "boolean" })
      .notNull()
      .default(false),
    pageEnabled: integer("page_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    /** Optional client PIN (T6.52), same PBKDF2 format as `galleries.pin_hash`. */
    pinHash: text("pin_hash"),
    /** Bumped on every PIN set/change/remove; part of the download-token fingerprint. */
    pinEpoch: integer("pin_epoch").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("clients_slug_nocase_unique").on(sql`${t.slug} COLLATE NOCASE`),
    check(
      "clients_slug_check",
      sql`length(${t.slug}) BETWEEN 1 AND 60 AND ${t.slug} NOT GLOB '*[^a-z0-9-]*' AND ${t.slug} NOT GLOB '-*' AND ${t.slug} NOT GLOB '*-' AND ${t.slug} NOT GLOB '*--*'`,
    ),
    check("clients_name_check", sql`length(${t.name}) BETWEEN 1 AND 120`),
    check(
      "clients_default_mode_check",
      sql`${t.defaultMode} IN ('proofing','delivery')`,
    ),
    check(
      "clients_default_show_on_home_check",
      sql`${t.defaultShowOnHome} IN (0,1)`,
    ),
    check("clients_page_enabled_check", sql`${t.pageEnabled} IN (0,1)`),
  ],
);

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
    // Client folder (T6.40): the album's client, or null. Deleting the client
    // unassigns its albums; albums are never deleted with a client.
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    // Photo versions (T6.53a): opt-in per album; off = `_v2` names keep their
    // plain meaning. Nothing reads it before the sync parser (T6.53b).
    versioning: integer("versioning", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("galleries_client_id_idx").on(t.clientId),
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
        ["versioning", t.versioning],
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

// Retouch rounds of a versioned album (T6.53a). Deleting the album deletes them.
export const deliveryRounds = sqliteTable(
  "delivery_rounds",
  {
    id: id(),
    galleryId: text("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    name: text("name"),
    startedAt: createdAt("started_at"),
  },
  (t) => [
    uniqueIndex("delivery_rounds_gallery_number_unique").on(
      t.galleryId,
      t.number,
    ),
    // Target of photo_versions' composite FK (same-gallery guarantee).
    uniqueIndex("delivery_rounds_id_gallery_id_unique").on(t.id, t.galleryId),
    check(
      "delivery_rounds_number_check",
      sql`typeof(${t.number}) = 'integer' AND ${t.number} >= 1`,
    ),
    check(
      "delivery_rounds_name_check",
      sql`${t.name} IS NULL OR length(${t.name}) BETWEEN 1 AND 120`,
    ),
  ],
);

// One row per (photo, version). `photos` stays the logical row and mirrors the
// LATEST version's columns; v1 rows of pre-0022 photos come from the 0022
// backfill, later rows from the sync parser (T6.53b). Server-only: the Drive
// ids never reach a client.
export const photoVersions = sqliteTable(
  "photo_versions",
  {
    photoId: text("photo_id").notNull(),
    galleryId: text("gallery_id").notNull(),
    version: integer("version").notNull(),
    roundId: text("round_id"),
    driveHighresId: text("drive_highres_id").notNull(),
    driveWebId: text("drive_web_id"),
    driveIgId: text("drive_ig_id"),
    driveThumbId: text("drive_thumb_id"),
    driveWmId: text("drive_wm_id"),
    driveThumbWmId: text("drive_thumb_wm_id"),
    driveTiffId: text("drive_tiff_id"),
    highresBytes: integer("highres_bytes"),
    // Same JSON as photos.variant_versions (each variant's Drive modifiedTime).
    driveVersions: text("drive_versions"),
    width: integer("width"),
    height: integer("height"),
    firstSeenAt: createdAt("first_seen_at"),
  },
  (t) => [
    primaryKey({ columns: [t.photoId, t.version] }),
    index("photo_versions_round_id_idx").on(t.roundId),
    check(
      "photo_versions_version_check",
      sql`typeof(${t.version}) = 'integer' AND ${t.version} >= 1`,
    ),
    // Composite FKs: photo and round must both belong to gallery_id. The round
    // FK is NO ACTION: a trigger in 0022 nulls round_id (only) when a round is
    // deleted, since SET NULL would also null gallery_id.
    foreignKey({
      columns: [t.galleryId, t.photoId],
      foreignColumns: [photos.galleryId, photos.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.roundId, t.galleryId],
      foreignColumns: [deliveryRounds.id, deliveryRounds.galleryId],
    }),
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
export type PhotoVersion = typeof photoVersions.$inferSelect;
export type DeliveryRound = typeof deliveryRounds.$inferSelect;
export type Visitor = typeof visitors.$inferSelect;
export type NewVisitor = typeof visitors.$inferInsert;
export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;
export type Download = typeof downloads.$inferSelect;
export type NewDownload = typeof downloads.$inferInsert;
export type GalleryView = typeof galleryViews.$inferSelect;
export type NewGalleryView = typeof galleryViews.$inferInsert;
