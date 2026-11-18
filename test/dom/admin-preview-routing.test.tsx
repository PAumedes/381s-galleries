import { matchRoutes, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";

import routes from "../../app/routes";

type Conf = {
  path?: string;
  index?: boolean;
  file: string;
  children?: Conf[];
};
const toObj = (r: Conf): RouteObject =>
  ({
    id: r.file,
    path: r.path,
    index: r.index,
    children: r.children?.map(toObj),
  }) as RouteObject;
const tree = (routes as unknown as Conf[]).map(toObj);
const PREVIEW = "routes/admin.g.$id.preview.tsx";

/** What React Router runs for a URL (single fetch strips a trailing `.data`). */
function leaf(pathname: string): string | null {
  const p = pathname.endsWith(".data") ? pathname.slice(0, -5) : pathname;
  const m = matchRoutes(tree, p);
  return m ? (m[m.length - 1]!.route.id ?? null) : null;
}

describe("admin preview route matching", () => {
  it("every case variant (and .data) reaches the admin-guarded preview loader", () => {
    for (const p of [
      "/admin/g/abc/preview",
      "/ADMIN/G/abc/PREVIEW",
      "/Admin/g/abc/Preview",
      "/admin/g/abc/preview/",
      "/admin/g/abc/preview.data",
      "/ADMIN/g/abc/PREVIEW.data",
    ])
      expect(leaf(p), p).toBe(PREVIEW);
  });

  it("is outside the admin layout (no shell) but still under /admin", () => {
    const m = matchRoutes(tree, "/admin/g/abc/preview")!;
    expect(m.map((x) => x.route.id)).toEqual([
      "routes/admin.g.$id.preview.tsx",
    ]);
  });

  it("never falls through to a public route", () => {
    for (const p of [
      "/admin/g/abc/PREVIEW.DATA",
      "/admin/g/abc/preview.json",
      "/admin/g/abc/preview/x",
    ]) {
      const id = leaf(p);
      expect(id, p).not.toBe("routes/$slug.tsx");
      expect(id === null || id.startsWith("routes/admin"), p).toBe(true);
    }
  });
});
