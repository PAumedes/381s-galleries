// Bundled by vite for the real-Chrome wizard test (T6.58): the real WizardView
// (or the home banner) in a memory router. Page query: ?lang=en|es,
// ?step=1..6, ?scenario=empty|ready|draft, ?view=banner, ?error=1.
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { WizardBanner } from "../../app/components/admin/wizard/WizardBanner";
import { WizardView } from "../../app/components/admin/wizard/WizardView";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";
import type { WizardData } from "../../app/lib/server/admin-wizard";
import { wizardStates } from "../../app/lib/wizard";

const params = new URLSearchParams(location.search);
setFallbackMessages(params.get("lang") === "en" ? en : es);
const scenario = params.get("scenario") ?? "empty";
const step = Number(params.get("step") ?? "1");

const ready = scenario !== "empty";
const published = scenario === "ready";
const facts = {
  driveReady: ready,
  clients: ready ? 1 : 0,
  galleries: ready ? 6 : 0,
  published: published ? 1 : 0,
};
const LONG = "Casamiento de Ana y Martín en la estancia de los abuelos 2026";
const data: WizardData = {
  step,
  states: wizardStates(facts),
  mock: false,
  connected: ready,
  driveReady: ready,
  rootName: ready ? "Sesiones 381" : null,
  clients: facts.clients,
  galleries: {
    count: facts.galleries,
    published: facts.published,
    recent: ready
      ? Array.from({ length: 5 }, (_, i) => ({
          id: `g${i}`,
          title: i === 0 ? LONG : `Sesión ${i}`,
          status:
            i === 0 && published ? ("published" as const) : ("draft" as const),
        }))
      : [],
  },
  target: ready
    ? {
        id: "g0",
        title: LONG,
        status: published ? "published" : "draft",
        mode: "proofing",
        pin: true,
        downloads: false,
        expiresAt: "2030-01-01T12:00:00.000Z",
        url: "https://gallery.381studios.ar/ana-y-martin-con-un-nombre-muy-largo/casamiento-de-ana-y-martin-en-la-estancia-2026",
        clientName: "Ana y Martín",
        clientUrl:
          "https://gallery.381studios.ar/ana-y-martin-con-un-nombre-muy-largo",
      }
    : null,
};

const view =
  params.get("view") === "banner" ? (
    <WizardBanner />
  ) : (
    <WizardView
      data={data}
      actionData={
        params.get("error")
          ? {
              intent: "createClient",
              ok: false,
              error: "Revisá los campos.",
              fieldErrors: { name: "Escribí un nombre para el cliente." },
            }
          : undefined
      }
    />
  );

const router = createMemoryRouter([{ path: "/admin/empezar", element: view }], {
  initialEntries: ["/admin/empezar"],
});
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
