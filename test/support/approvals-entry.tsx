// Bundled by vite for the real-Chrome test of the approvals (T6.53f): the real
// GalleryView of a versioned album with every image replaced by an inline SVG
// and an in-page fake of the server (favorites list with the visitor's
// approvals, approvals POST), no network. Location hash segments, joined by
// `&`: `es` / `en`; `ver3` = the photo p0 shows v3 (default v2); `approved2` =
// the server already lists p0 approved at v2; `fail` = the POST answers 500;
// `stale` = it answers 409 stale; `off` = the album has no approvals.
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { GalleryView } from "../../app/components/GalleryView";
import { ImgUrlProvider } from "../../app/components/img-url";
import type { GalleryPhoto, OpenGallery } from "../../app/components/types";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";

const hash = location.hash.slice(1).split("&");
const lang = hash[0] === "en" ? "en" : "es";
const messages = lang === "en" ? en : es;
setFallbackMessages(messages);
const has = (s: string) => hash.includes(s);
const num = (prefix: string, fallback: number) => {
  const h = hash.find((s) => s.startsWith(prefix));
  return h ? Number(h.slice(prefix.length)) : fallback;
};

const shown = num("ver", 2);
const approvedAt = num("approved", 0);
const posts: unknown[] = [];
(window as unknown as { __posts: unknown[] }).__posts = posts;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
window.fetch = async (input, init) => {
  const url = String(input);
  if (init?.method === "POST" && url.endsWith("/approvals")) {
    posts.push(JSON.parse(String(init.body)));
    if (has("fail")) return json({ error: "boom" }, 500);
    if (has("stale")) return json({ error: "stale" }, 409);
    return json({ ok: true });
  }
  return json({
    visitor: null,
    favorites: [],
    ...(has("off")
      ? {}
      : { approvals: approvedAt ? [{ id: "p0", ver: approvedAt }] : [] }),
  });
};

const svg = (n: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#${n % 2 ? "a33" : "3a3"}"/><text x="40" y="120" font-size="100" fill="#fff">v${n}</text></svg>`,
  )}`;
const imgUrl = (_id: string, _variant: string, _v?: string, ver?: number) =>
  svg(ver ?? shown);

const base = {
  width: 1200,
  height: 800,
  set: "Fotos",
  variants: { web: true, ig: false },
};
const history = Array.from({ length: shown }, (_, i) => ({
  n: i + 1,
  round: i === 0 ? null : i + 1,
  at: `2026-03-0${i + 1}T15:00:00.000Z`,
  v: `t${i + 1}`,
}));
const photos: GalleryPhoto[] = [
  { ...base, id: "p0", v: `t${shown}`, ver: shown, versions: history },
  { ...base, id: "p1", v: "u1" },
  { ...base, id: "p2", v: "w1" },
];
const gallery: OpenGallery = {
  slug: "retoque",
  requireEmail: false,
  title: "Retoque",
  eventDate: "2026-03-14",
  coverPhotoId: "p0",
  allowBulk: false,
  allowHighres: false,
  allowWeb: false,
  allowIg: false,
  mode: "delivery",
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
  sets: [{ name: "Fotos", count: 3 }],
  round: shown,
  ...(has("off") ? {} : { approvals: true as const }),
};

const router = createMemoryRouter([
  {
    id: "root",
    path: "/",
    loader: () => ({ lang, messages, studioName: "381 Studios" }),
    Component: () => (
      <ImgUrlProvider value={imgUrl}>
        <GalleryView gallery={gallery} photos={photos} />
      </ImgUrlProvider>
    ),
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
