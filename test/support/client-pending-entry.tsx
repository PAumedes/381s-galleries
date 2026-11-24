// Bundled by vite for the real-Chrome pending-button test (T6.46): the real
// client list/create form in a memory router whose action never resolves, so a
// click leaves the submit button in its pending state. Language: location.hash.
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ClientList } from "../../app/components/admin/clients/ClientList";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";

const lang = location.hash === "#en" ? "en" : "es";
setFallbackMessages(lang === "en" ? en : es);

const router = createMemoryRouter([
  {
    path: "/",
    action: () => new Promise(() => {}),
    Component: () => (
      <ClientList clients={[]} message={null} actionData={undefined} />
    ),
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
