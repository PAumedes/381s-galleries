import { useRouteLoaderData } from "react-router";

import type { loader as rootLoader } from "../root";
import { useStudioName } from "../lib/use-studio-name";

export type LogoVariant = "dark" | "light";

export interface LogoSource {
  src: string;
  /** True for the uploaded light-background logo shown on a dark one. */
  invert: boolean;
}

/**
 * Which uploaded file to show, or null when none applies (the studio name is
 * then shown as a text wordmark; nothing of any brand is bundled). Uploads
 * come from /brand/logo/:variant (the root loader sends only their versions).
 * With no dark-background upload, the light-background one is inverted by CSS.
 */
export function logoSource(
  variant: LogoVariant,
  logo?: { onLight?: string | null; onDark?: string | null } | null,
): LogoSource | null {
  const url = (name: string, v: string) =>
    `/brand/logo/${name}?v=${encodeURIComponent(v)}`;
  if (variant === "dark")
    return logo?.onLight
      ? { src: url("on-light", logo.onLight), invert: false }
      : null;
  if (logo?.onDark) return { src: url("on-dark", logo.onDark), invert: false };
  if (logo?.onLight)
    return { src: url("on-light", logo.onLight), invert: true };
  return null;
}

const MIN_FONT_REM = 0.875;
const DEFAULT_BOX = 8;
/**
 * The `h-N` box (N in 0.25rem steps) of a class list. Limitation: only a bare
 * `h-N` is read (no `sm:h-N`, `h-[..]`, `h-full`); callers pass one fixed
 * `h-N`, and anything else falls back to `h-8` sizing.
 */
function boxSteps(className: string): number {
  return Number(/(?:^|\s)h-(\d+)(?:\s|$)/.exec(className)?.[1] ?? DEFAULT_BOX);
}
/** Font size that fits the box on one line. */
function wordmarkFontSize(className: string): string {
  return `max(${MIN_FONT_REM}rem, ${boxSteps(className) * 0.075}rem)`;
}
/** Non-Latin scripts (Arabic, Hebrew, CJK...): no wide tracking. */
const NON_LATIN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

/**
 * Text stand-in for the logo: the studio name in the display typography.
 * Same box as the image (size it with one fixed `h-N` class); one line,
 * truncated. A plain inline-block so the caller's display utilities win.
 */
export function Wordmark({
  name,
  variant = "dark",
  className = "",
  fontSize,
}: {
  name: string;
  variant?: LogoVariant;
  className?: string;
  /** Overrides the size derived from the `h-N` class (e.g. print cards). */
  fontSize?: string;
}) {
  return (
    <span
      data-logo="wordmark"
      dir="auto"
      style={{
        fontSize: fontSize ?? wordmarkFontSize(className),
        // centres the line in the `h-N` box (with `fontSize` the caller sets
        // `leading-*`; a block, so display utilities
        // from the caller, e.g. `hidden sm:block`, win over the base).
        lineHeight: fontSize ? undefined : `${boxSteps(className) * 0.25}rem`,
      }}
      className={`inline-block min-w-0 max-w-full select-none truncate font-light uppercase ${NON_LATIN.test(name) ? "" : "tracking-[0.2em]"} ${variant === "light" ? "text-white" : "text-black"} ${className}`}
    >
      {name}
    </span>
  );
}

/**
 * Studio logo: the uploaded one (Ajustes), else the studio name as text. Size
 * it with a height class (e.g. `h-8`); width follows the content.
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
  const source = logoSource(variant, logo);
  if (!source)
    return <Wordmark name={label} variant={variant} className={className} />;
  return (
    <img
      src={source.src}
      alt={label}
      className={`w-auto max-w-full select-none ${source.invert ? "brightness-0 invert" : ""} ${className}`}
      draggable={false}
    />
  );
}
