import { env } from "cloudflare:workers";

import { getStudioName } from "../lib/server/admin";
import { Logo } from "../components/Logo";
import { SiteFooter } from "../components/SiteFooter";
import type { Route } from "./+types/home";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData.studioName }];
}

export async function loader() {
  return { studioName: await getStudioName(env) };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-6">
      <h1>
        <Logo variant="dark" name={loaderData.studioName} className="h-24" />
      </h1>
      <SiteFooter />
    </main>
  );
}
