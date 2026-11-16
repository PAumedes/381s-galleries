import { useStudioName } from "../lib/use-studio-name";

/**
 * Placeholder wordmark rendered as inline text so it can use the web font
 * (SVG text inside <img> cannot).
 *
 * TODO(real logo): when the real SVG files arrive, put them in public/brand/
 * (logo-black.svg, logo-white.svg; the placeholders are still there) and
 * replace the <span> below with:
 *   <img
 *     src={variant === "dark" ? "/brand/logo-black.svg" : "/brand/logo-white.svg"}
 *     alt={label} width={240} height={32} className={className} draggable={false}
 *   />
 * then give callers `h-6 w-auto`-style heights again (they pass text sizes now).
 */
export function Logo({
  variant = "dark",
  name,
  className = "",
}: {
  /** "dark" = black logo for light backgrounds; "light" = white logo. */
  variant?: "dark" | "light";
  name?: string;
  className?: string;
}) {
  const studio = useStudioName();
  const label = name ?? studio;
  return (
    <span
      className={`${variant === "dark" ? "text-ink" : "text-white"} font-light tracking-[0.4em] whitespace-nowrap uppercase select-none ${className}`}
    >
      {label}
    </span>
  );
}
