import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
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
    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("draft"),
    coverPhotoId: text("cover_photo_id"),
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
    useWatermarkPreview: integer("use_watermark_preview", { mode: "boolean" })
      .notNull()
      .default(false),
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
    highresBytes: integer("highres_bytes"),
    // JSON {highres,web,ig,thumb,wm}: each variant's Drive modifiedTime (cache validation).
    variantVersions: text("variant_versions"),
    width: integer("width"),
    height: integer("height"),
    takenAt: text("taken_at"),
    sort: integer("sort").notNull().default(0),
    // Set when sync first sees the photo's high-res file missing; hard-deleted
    // only after a grace period. Client queries MUST filter `missing_since IS NULL`.
    missingSince: text("missing_since"),
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
    // Case-insensitive; app code must also trim + lowercase emails (PLAN 5.4).
    uniqueIndex("visitors_gallery_email_nocase_unique").on(
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

// Stats tables intentionally have no FKs so history survives gallery deletion.
export const downloads = sqliteTable(
  "downloads",
  {
    id: id(),
    galleryId: text("gallery_id").notNull(),
    photoId: text("photo_id"),
    visitorId: text("visitor_id"),
    variant: text("variant", { enum: ["highres", "web", "ig"] }).notNull(),
    kind: text("kind", { enum: ["single", "bulk"] }).notNull(),
    country: text("country"),
    ua: text("ua"),
    createdAt: createdAt(),
  },
  (t) => [
    index("downloads_gallery_created_idx").on(t.galleryId, t.createdAt),
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
