import { env } from "cloudflare:workers";

import { HomePage } from "../components/HomePage";
import { getStudioName } from "../lib/server/admin";
import { loadHome } from "../lib/server/home";
import { publicOrigin } from "../lib/server/public-url";
import { homeMeta } from "../lib/og";
import type { Route } from "./+types/home";
import { PRIVATE_NO_STORE } from "../lib/server/http";

export function meta({ loaderData }: Route.MetaArgs) {
  return homeMeta(
    loaderData.items[0] ? { coverId: loaderData.items[0].cover.id } : null,
    { studio: loaderData.studioName, origin: loaderData.origin },
  );
}

// The list depends on live gallery state (PIN, status): never cache it.
export function headers() {
  return { "Cache-Control": PRIVATE_NO_STORE };
}

// `args` is optional: tests (and no-request callers) call the loader bare.
export async function loader(args?: Route.LoaderArgs) {
  const [studioName, home] = await Promise.all([
    getStudioName(env),
    loadHome(env),
  ]);
  return {
    studioName,
    origin: args ? publicOrigin(env, args.request) : (env.PUBLIC_ORIGIN ?? ""),
    items: home.items,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return <HomePage items={loaderData.items} />;
}
