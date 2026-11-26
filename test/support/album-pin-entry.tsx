// Bundled by vite for the real-Chrome album PIN layout test (T6.54): the real
// PinSection of the album editor. Language: location.hash (#es / #en).
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { PinSection } from "../../app/components/admin/gallery-edit/PinSection";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";

setFallbackMessages(location.hash === "#en" ? en : es);

const router = createMemoryRouter([
  {
    path: "/",
    Component: () => (
      <PinSection hasPin errors={{}} busy={false} actionData={undefined} />
    ),
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
