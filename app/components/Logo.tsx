import { useRouteLoaderData } from "react-router";

import type { loader as rootLoader } from "../root";

export function Logo({
  variant = "dark",
  name,
  className,
}: {
  /** "dark" = black logo for light backgrounds; "light" = white logo. */
  variant?: "dark" | "light";
  name?: string;
  className?: string;
}) {
  const data = useRouteLoaderData<typeof rootLoader>("root");
  return (
    <img
      src={
        variant === "dark" ? "/brand/logo-black.svg" : "/brand/logo-white.svg"
      }
      alt={name ?? data?.studioName ?? "381 Studios"}
      width={240}
      height={32}
      className={className}
      draggable={false}
    />
  );
}
