import { env } from "cloudflare:workers";

import type { Route } from "./+types/home";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData.studioName }];
}

export function loader() {
  return { studioName: env.STUDIO_NAME };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-light tracking-[0.3em] uppercase">
        {loaderData.studioName}
      </h1>
    </main>
  );
}
