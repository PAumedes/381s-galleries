// Bundled by vite for the real-Chrome help test (T6.57): the real HelpView in a
// memory router. Page query: ?lang=en|es, ?q=<search>, ?at=<anchor>.
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { HelpView } from "../../app/components/admin/help/HelpView";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";

const params = new URLSearchParams(location.search);
setFallbackMessages(params.get("lang") === "en" ? en : es);
const q = params.get("q");
const at = params.get("at");
const entry = `/admin/ayuda${q ? `?q=${encodeURIComponent(q)}` : ""}${at ? `#${at}` : ""}`;

const router = createMemoryRouter(
  [{ path: "/admin/ayuda", Component: HelpView }],
  { initialEntries: [entry] },
);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
