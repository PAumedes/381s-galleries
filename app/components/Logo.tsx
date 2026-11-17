import { useStudioName } from "../lib/use-studio-name";

/**
 * Studio mark ("38 / 1S"). Vector files in public/brand/:
 * logo-black.svg for light backgrounds, logo-white.svg for dark ones.
 * Size it with a height class (e.g. `h-8`); width follows the aspect ratio.
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
    <img
      src={
        variant === "dark" ? "/brand/logo-black.svg" : "/brand/logo-white.svg"
      }
      alt={label}
      width={462}
      height={632}
      className={`w-auto select-none ${className}`}
      draggable={false}
    />
  );
}
