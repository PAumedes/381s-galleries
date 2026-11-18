import { useCallback, useState } from "react";
import type { ImgHTMLAttributes } from "react";

/**
 * An image that shows `placeholder` (a small version the browser already has)
 * in the same box until the real one has loaded, then fades the real one in
 * over it: no blank frame, no layout shift (both fill the same positioned
 * parent via `className`). Without a placeholder it is a plain `<img>`.
 * The placeholder stays underneath (the real image is opaque), so there is
 * no flash at the end of the fade.
 */
export function FadeImg({
  placeholder = null,
  src,
  onElement,
  className = "",
  style,
  onLoad,
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "placeholder"> & {
  placeholder?: string | null;
  /** Receives the real image element (null on unmount), e.g. to measure it. */
  onElement?: (el: HTMLImageElement | null) => void;
}) {
  const [loaded, setLoaded] = useState<string | null>(null);
  // A cached image can be complete before React attaches onLoad.
  const setRef = useCallback(
    (el: HTMLImageElement | null) => {
      if (el && el.complete && el.naturalWidth > 0)
        setLoaded(el.getAttribute("src"));
      onElement?.(el);
    },
    [onElement],
  );
  const fade = placeholder
    ? loaded === src
      ? " opacity-100 transition-opacity duration-base"
      : " opacity-0"
    : "";
  return (
    <>
      {placeholder && (
        <img
          data-placeholder=""
          src={placeholder}
          alt=""
          draggable={false}
          aria-hidden="true"
          className={className}
          style={style}
        />
      )}
      <img
        {...rest}
        ref={setRef}
        src={src}
        className={className + fade}
        style={style}
        onLoad={(e) => {
          setLoaded(src ?? null);
          onLoad?.(e);
        }}
      />
    </>
  );
}
