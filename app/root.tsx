import { env } from "cloudflare:workers";
import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { en } from "./i18n/en";
import { es } from "./i18n/es";
import { getLang, langCookie } from "./i18n/lang";
import { makeT } from "./i18n/t";

export async function loader({ request }: Route.LoaderArgs) {
  const lang = getLang(request);
  const payload = {
    lang,
    messages: lang === "en" ? en : es,
    studioName: env.STUDIO_NAME,
  };
  const explicit = new URL(request.url).searchParams.has("lang");
  return data(
    payload,
    explicit ? { headers: { "Set-Cookie": langCookie(lang) } } : undefined,
  );
}

// HTML varies by language (cookie / Accept-Language) and may set the lang
// cookie: never let a shared cache store it.
export function headers(_: Route.HeadersArgs) {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie, Accept-Language",
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const loaderData = useRouteLoaderData<typeof loader>("root");
  return (
    <html lang={loaderData?.lang ?? "es"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const loaderData = useRouteLoaderData<typeof loader>("root");
  const t = makeT(loaderData?.lang ?? "es", loaderData?.messages ?? es);

  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const title = notFound ? t("error.notFound.title") : t("error.generic.title");
  const message = notFound
    ? t("error.notFound.message")
    : t("error.generic.message");
  const stack =
    import.meta.env.DEV && error instanceof Error ? error.stack : undefined;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-title text-ink">{title}</h1>
      <p className="text-body text-grey-600">{message}</p>
      <a href="/" className="text-micro-label text-grey-600 hover:text-ink">
        {t("error.home")}
      </a>
      {stack && (
        <pre className="text-small text-grey-600 w-full max-w-3xl overflow-x-auto p-4 text-left">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
