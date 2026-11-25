// Bundled by vite for the real-Chrome album list filters test (T6.54): the
// real GalleryList (search, client filter, status chips, rows) in a memory
// router. Language: location.hash (#es / #en).
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { GalleryList } from "../../app/components/admin/GalleryList";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";

setFallbackMessages(location.hash === "#en" ? en : es);

const base = {
  slug: "s",
  clientName: null,
  eventDate: "2026-11-01",
  status: "published" as const,
  mode: "delivery" as const,
  expiresAt: null,
  expired: false,
  coverPhotoId: null,
  photoCount: 1,
  views: 0,
  downloads: 0,
  issueCount: 0,
  deleting: false,
  client: null,
};
const clients = [
  { id: "a", name: "Acme", slug: "acme" },
  { id: "b", name: "Ñandú ".repeat(20), slug: "nandu" },
];
const rows = [
  { ...base, id: "1", title: "Boda Ana", client: clients[0] },
  { ...base, id: "2", title: "Sin cliente" },
];

const router = createMemoryRouter(
  [
    {
      path: "/admin",
      Component: () => (
        <GalleryList
          galleries={rows}
          filter="todas"
          total={2}
          clients={clients}
          clientFilter=""
        />
      ),
    },
  ],
  { initialEntries: ["/admin"] },
);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
