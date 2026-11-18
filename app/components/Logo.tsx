import { useRouteLoaderData } from "react-router";

import type { loader as rootLoader } from "../root";
import { useStudioName } from "../lib/use-studio-name";

export type LogoVariant = "dark" | "light";

export interface LogoSource {
  src: string;
  /** True for the bundled/uploaded light-background logo shown on a dark one. */
  invert: boolean;
  /** Uploaded logos have an unknown aspect ratio. */
  custom: boolean;
}

/**
 * Which file to show. Uploaded logos come from /brand/logo/:variant (the root
 * loader sends only their versions); the bundled SVGs are the default. With no
 * dark-background upload, the light-background one is inverted by CSS.
 */
export function logoSource(
  variant: LogoVariant,
  logo?: { onLight?: string | null; onDark?: string | null } | null,
): LogoSource {
  const url = (name: string, v: string) =>
    `/brand/logo/${name}?v=${encodeURIComponent(v)}`;
  if (variant === "dark")
    return logo?.onLight
      ? { src: url("on-light", logo.onLight), invert: false, custom: true }
      : { src: "/brand/logo-black.svg", invert: false, custom: false };
  if (logo?.onDark)
    return { src: url("on-dark", logo.onDark), invert: false, custom: true };
  if (logo?.onLight)
    return { src: url("on-light", logo.onLight), invert: true, custom: true };
  return { src: "/brand/logo-white.svg", invert: false, custom: false };
}

/**
 * Studio mark ("38 / 1S"). Bundled vector files in public/brand/ are the
 * default; the admin can replace them (Ajustes). Size it with a height class
 * (e.g. `h-8`); width follows the aspect ratio.
 */
export function Logo({
  variant = "dark",
  name,
  className = "",
}: {
  /** "dark" = logo for light backgrounds; "light" = logo for dark ones. */
  variant?: LogoVariant;
  name?: string;
  className?: string;
}) {
  const studio = useStudioName();
  const logo = useRouteLoaderData<typeof rootLoader>("root")?.logo;
  const label = name ?? studio;
  const { src, invert, custom } = logoSource(variant, logo);
  return (
    <img
      src={src}
      alt={label}
      {...(custom ? {} : { width: 462, height: 632 })}
      className={`w-auto max-w-full select-none ${invert ? "brightness-0 invert" : ""} ${className}`}
      draggable={false}
    />
  );
}
