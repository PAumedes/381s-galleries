import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("privacidad", "routes/privacidad.tsx"),
  route("admin/google/connect", "routes/admin.google.connect.tsx"),
  route("admin/google/callback", "routes/admin.google.callback.tsx"),
  route(
    "admin/img/:photoId/:variant",
    "routes/admin.img.$photoId.$variant.tsx",
  ),
  // Outside the admin layout: the print card must not carry the shell.
  route("admin/g/:id/card", "routes/admin.g.$id.card.tsx"),
  // The admin-only preview of the client gallery: no shell either.
  route("admin/g/:id/preview", "routes/admin.g.$id.preview.tsx"),
  // Resource routes (downloads): outside the layout too.
  route("admin/g/:id/activity.csv", "routes/admin.g.$id.activity-csv.tsx"),
  route("admin/g/:id/favorites.txt", "routes/admin.g.$id.favorites-txt.tsx"),
  route("admin", "routes/admin.tsx", [
    index("routes/admin._index.tsx"),
    route("setup", "routes/admin.setup.tsx"),
    route("g/:id", "routes/admin.g.$id.tsx"),
    route("g/:id/activity", "routes/admin.g.$id.activity.tsx"),
    route("g/:id/favorites", "routes/admin.g.$id.favorites.tsx"),
    // T6.40b clients admin
    route("clients", "routes/admin.clients.tsx"),
    route("clients/:id", "routes/admin.clients.$id.tsx"),
  ]),
  route("img/:photoId/:variant", "routes/img.$photoId.$variant.tsx"),
  route("brand/logo/:variant", "routes/brand.logo.$variant.tsx"),
  route("dl/:token", "routes/dl.$token.tsx"),
  route("api/admin/sync", "routes/api.admin.sync.tsx"),
  route("manifest.webmanifest", "routes/manifest.tsx"),
  route("api/g/:slug/manifest.webmanifest", "routes/api.g.$slug.manifest.tsx"),
  route("api/g/:slug/visitor", "routes/api.g.$slug.visitor.tsx"),
  route("api/g/:slug/favorites", "routes/api.g.$slug.favorites.tsx"),
  route("api/g/:slug/approvals", "routes/api.g.$slug.approvals.tsx"),
  route(
    "api/g/:slug/download-tokens",
    "routes/api.g.$slug.download-tokens.tsx",
  ),
  route("api/g/:slug/bulk", "routes/api.g.$slug.bulk.tsx"),
  // Dynamic routes last: every static route above outranks them, and the
  // two-segment one (T6.40d) outranks nothing static; `:slug` is the last resort.
  route(":client/:album", "routes/$client.$album.tsx"),
  route(":slug", "routes/$slug.tsx"),
] satisfies RouteConfig;
