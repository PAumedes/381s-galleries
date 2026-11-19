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
import { nonceContext } from "./lib/server/context";
import { isAdmin } from "./lib/server/auth";
import { getStudioName } from "./lib/server/admin";
import { fallbackMessages } from "./i18n/fallback";
import { messagesForRequest } from "./i18n/dictionaries";
import { isAdminPath, langCookie } from "./i18n/lang";
import { validPublicOrigin } from "./lib/server/public-url";
import { getLogoVersions } from "./lib/server/logo";
import { pwaMeta } from "./lib/pwa";
import { DEFAULT_STUDIO_NAME } from "./lib/default-studio-name";
import { makeT } from "./i18n/t";

export async function loader({ request, context }: Route.LoaderArgs) {
  // /admin (and its .data requests) use the admin_lang cookie; the public
  // site keeps ?lang= / lang cookie / Accept-Language. Admin strings are sent
  // only to a verified admin.
  const url = new URL(request.url);
  // Admin strings only for a verified admin (the verdict is cached per
  // request, so the admin route's own requireAdmin does not verify again).
  const verifiedAdmin =
    isAdminPath(url.pathname) && (await isAdmin(request, env));
  const { lang, messages } = messagesForRequest(request, verifiedAdmin);
  const payload = {
    lang,
    messages,
    // Public canonical origin (not a secret): used by the client share URL.
    origin: validPublicOrigin(env) ?? undefined,
    studioName: await getStudioName(env, request),
    // Cache-busting versions of the uploaded logos (null = bundled logo).
    logo: await getLogoVersions(env),
    // CSP nonce for the inline A2HS script (the browser hides it from the DOM
    // after parsing, and only the server render needs it).
    nonce: context.get(nonceContext),
  };
  const explicit = !isAdminPath(url.pathname) && url.searchParams.has("lang");
  return data(
    payload,
    explicit ? { headers: { "Set-Cookie": langCookie(lang) } } : undefined,
  );
}

// Runs before hydration: keeps a beforeinstallprompt that fired early so the
// Add-to-home hint can still use it (window.__a2hs + "a2hs" event).
const A2HS_CAPTURE =
  'addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__a2hs=e;dispatchEvent(new Event("a2hs"))})';

// Generic studio manifest + iOS tags; the gallery route replaces them.
export function meta({ loaderData }: Route.MetaArgs) {
  return pwaMeta(undefined, {
    studio: loaderData?.studioName ?? DEFAULT_STUDIO_NAME,
  });
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
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {loaderData?.nonce ? (
          <script
            nonce={loaderData.nonce}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: A2HS_CAPTURE }}
          />
        ) : null}
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={loaderData?.nonce} />
        <Scripts nonce={loaderData?.nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const loaderData = useRouteLoaderData<typeof loader>("root");
  const t = makeT(
    loaderData?.lang ?? "es",
    loaderData?.messages ?? fallbackMessages(),
  );

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
      <a
        href="/"
        className="text-micro-label text-grey-600 hover:text-ink inline-flex min-h-tap items-center"
      >
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
