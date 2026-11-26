// Bundled by vite for the real-Chrome test of the TIFF delivery tile (T6.53d2):
// the real ClientPage with a normal tile, a PIN tile and a TIFF delivery tile.
// location.hash: es|en.
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ClientPage } from "../../app/components/ClientPage";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";
import type { ClientPageData } from "../../app/lib/server/client-page";

const lang = location.hash === "#en" ? "en" : "es";
const messages = lang === "en" ? en : es;
setFallbackMessages(messages);

const page: ClientPageData = {
  state: "client",
  clientName: "ACME Corp",
  clientSlug: "acme",
  page: 1,
  pageCount: 1,
  items: [
    {
      slug: "boda",
      clientSlug: "acme",
      title: "Boda Ana",
      eventDate: "2026-03-14",
      cover: null,
      tiffOnly: true,
    },
    {
      slug: "privado",
      clientSlug: "acme",
      title: "Privado",
      eventDate: null,
      cover: null,
      locked: true,
    },
    {
      slug: "largo",
      clientSlug: "acme",
      title: "Entrega ".repeat(40),
      eventDate: null,
      cover: null,
      tiffOnly: true,
    },
  ],
};

const router = createMemoryRouter([
  {
    id: "root",
    path: "/",
    loader: () => ({ lang, messages, studioName: "Estudio Test" }),
    Component: () => <ClientPage page={page} />,
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
