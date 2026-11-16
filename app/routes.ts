import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("admin", "routes/admin._index.tsx"),
  route("admin/google/connect", "routes/admin.google.connect.tsx"),
  route("admin/google/callback", "routes/admin.google.callback.tsx"),
  route("img/:photoId/:variant", "routes/img.$photoId.$variant.tsx"),
  route("dl/:token", "routes/dl.$token.tsx"),
  route("api/admin/sync", "routes/api.admin.sync.tsx"),
  route("api/g/:slug/visitor", "routes/api.g.$slug.visitor.tsx"),
  route("api/g/:slug/favorites", "routes/api.g.$slug.favorites.tsx"),
  route(
    "api/g/:slug/download-tokens",
    "routes/api.g.$slug.download-tokens.tsx",
  ),
  route("api/g/:slug/bulk", "routes/api.g.$slug.bulk.tsx"),
  // Last: static routes above always outrank this dynamic segment.
  route(":slug", "routes/$slug.tsx"),
] satisfies RouteConfig;
