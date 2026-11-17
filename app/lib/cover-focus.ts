/**
 * Cover focal point maths. The focal point is a point ON THE IMAGE
 * (u, v = percent of its width/height). `object-fit: cover` crops the image
 * to the frame, so `object-position` is derived per axis at render time:
 * keep (u, v) as close to the frame center as the crop allows.
 */
export type Focus = { x: number; y: number };

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/** One axis: S = scaled image size, F = frame size, u = image fraction (0-100). */
export function axisPosition(u: number, S: number, F: number): number {
  if (!(S > F) || !Number.isFinite(S) || !Number.isFinite(F)) return 50;
  return clamp(((u / 100) * S - F / 2) / (S - F), 0, 1) * 100;
}

/**
 * object-position (percent) for a cover-fitted image of aspect `aspect`
 * (width/height) in a `frame`; 50/50 when the focus, aspect or frame is unknown.
 */
export function coverObjectPosition(
  focus: Focus | null,
  aspect: number | null,
  frame: { w: number; h: number } | null,
): Focus {
  if (
    !focus ||
    !frame ||
    !aspect ||
    !(aspect > 0) ||
    !(frame.w > 0) ||
    !(frame.h > 0)
  )
    return { x: 50, y: 50 };
  // Scale at which the image covers the frame (image height = 1 unit).
  const s = Math.max(frame.w / aspect, frame.h);
  const Sw = aspect * s;
  const Sh = s;
  return {
    x: axisPosition(focus.x, Sw, frame.w),
    y: axisPosition(focus.y, Sh, frame.h),
  };
}
