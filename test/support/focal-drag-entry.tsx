// Bundled by esbuild for the real-Chrome focal drag test (T6.35): the real
// CoverPreview in a memory router whose action records the submitted form.
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { CoverPreview } from "../../app/components/admin/CoverPreview";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";

setFallbackMessages(es);
const w = window as unknown as { __saved?: Record<string, string> };

const router = createMemoryRouter([
  {
    path: "/",
    action: async ({ request }) => {
      w.__saved = Object.fromEntries(
        [...(await request.formData())].map(([k, v]) => [k, String(v)]),
      );
      return { ok: true, intent: "focus", message: "ok" };
    },
    Component: () => (
      <div style={{ padding: 16 }}>
        <p style={{ height: 400 }}>above</p>
        <CoverPreview
          title="T"
          eventDate={null}
          palette="claro"
          coverLayout="completa"
          proofing={false}
          coverId="p1"
          coverWidth={3000}
          coverHeight={2000}
          initialFocus={null}
          device="desktop"
          onDevice={() => {}}
        />
        <p style={{ height: 1500 }}>below</p>
      </div>
    ),
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
