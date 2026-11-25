// Bundled by vite for the real-Chrome client PIN test (T6.52): the real client
// edit view in a memory router whose action never resolves, so a click leaves
// the PIN submit button pending. Language: location.hash (#es / #en);
// `?err` shows a long server field error.
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ClientEditView } from "../../app/components/admin/clients/ClientEditView";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";

const lang = location.hash === "#en" ? "en" : "es";
setFallbackMessages(lang === "en" ? en : es);
const long = "Ñandú ".repeat(30);

const router = createMemoryRouter([
  {
    path: "/",
    action: () => new Promise(() => {}),
    Component: () => (
      <ClientEditView
        client={{
          id: "c1",
          name: long,
          slug: "x".repeat(60),
          pageEnabled: true,
          defaultMode: "proofing",
          defaultShowOnHome: false,
          hasPin: true,
        }}
        albums={[]}
        publicPage={{ visible: 0, reason: "none" }}
        actionData={{
          intent: "pinSet",
          ok: false,
          error: "Revisá el PIN. " + long,
          fieldErrors: { pin: "El PIN debe tener entre 6 y 32. " + long },
        }}
      />
    ),
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
