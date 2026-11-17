import { env } from "cloudflare:workers";

import { Logo } from "../components/Logo";
import type { Route } from "./+types/home";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData.studioName }];
}

export function loader() {
  return { studioName: env.STUDIO_NAME };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <h1>
        <Logo variant="dark" name={loaderData.studioName} className="h-24" />
      </h1>
    </main>
  );
}
