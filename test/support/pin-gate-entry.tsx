// Bundled by vite for the real-Chrome PIN gate test (T6.54): the real PinScreen
// in a memory router whose action refuses every PIN like the server does (400
// with the next attempt number) once the test calls `window.__release()`, so
// the pending state can be observed. Language: location.hash (#es / #en).
import { createRoot } from "react-dom/client";
import {
  createMemoryRouter,
  data,
  RouterProvider,
  useActionData,
} from "react-router";
import { PinScreen } from "../../app/components/PinScreen";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { setFallbackMessages } from "../../app/i18n/fallback";

declare global {
  interface Window {
    __release?: () => void;
  }
}
setFallbackMessages(location.hash === "#en" ? en : es);

const router = createMemoryRouter([
  {
    path: "/",
    action: async ({ request }) => {
      const posted = Number((await request.formData()).get("attempt")) || 0;
      await new Promise<void>((resolve) => {
        window.__release = resolve;
      });
      const attempt = posted + 1;
      return data(
        { error: `PIN del cliente incorrecto (intento ${attempt})`, attempt },
        { status: 400 },
      );
    },
    Component: function Gate() {
      const actionData = useActionData() as
        { error?: string; attempt?: number } | undefined;
      return (
        <PinScreen
          title="Boda"
          step="client"
          error={actionData?.error}
          attempt={actionData?.attempt}
        />
      );
    },
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
