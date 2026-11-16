import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("admin", "routes/admin._index.tsx"),
  route("admin/google/connect", "routes/admin.google.connect.tsx"),
  route("admin/google/callback", "routes/admin.google.callback.tsx"),
  route("api/admin/sync", "routes/api.admin.sync.tsx"),
] satisfies RouteConfig;
