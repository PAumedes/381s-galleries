/**
 * The device (desktop / mobile) an admin looks at while editing a cover, and
 * the links that carry it between the editor and the "Vista previa" page
 * (which opens in a new tab: no shared state, so the URL carries it).
 */
export type PreviewDevice = "desktop" | "mobile";

/**
 * Viewports that get the optional mobile cover (a `<picture>` source, so the
 * browser downloads only the one it shows).
 */
export const MOBILE_COVER_MEDIA = "(max-width: 767px)";

export const DEVICE_PARAM = "device";
export const STORAGE_KEY = "381s.previewDevice";

export const isDevice = (v: unknown): v is PreviewDevice =>
  v === "desktop" || v === "mobile";

/** Phones start on mobile, everything else on desktop. */
export function viewportDevice(): PreviewDevice {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_COVER_MEDIA).matches
    ? "mobile"
    : "desktop";
}

function stored(): PreviewDevice | null {
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    return isDevice(v) ? v : null;
  } catch {
    return null; // storage blocked (private mode)
  }
}

/** Browser only: the URL's choice, else the remembered one, else the viewport's. */
export function resolveDevice(param: string | null): PreviewDevice {
  return isDevice(param) ? param : (stored() ?? viewportDevice());
}

export function rememberDevice(d: PreviewDevice): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, d);
  } catch {
    // storage blocked: the choice still lives in component state
  }
}

function href(path: string, query: [string, string | undefined][]) {
  const q = query
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return q ? `${path}?${q}` : path;
}

const withoutDatos = (tab?: string) =>
  tab && tab !== "datos" ? tab : undefined;

export const previewHref = (id: string, device: PreviewDevice, tab?: string) =>
  href(`/admin/g/${encodeURIComponent(id)}/preview`, [
    [DEVICE_PARAM, device],
    ["tab", withoutDatos(tab)],
  ]);

/** Back to the editor. `device` undefined = not known yet (omitted). */
export const editorHref = (
  id: string,
  device: PreviewDevice | undefined,
  tab?: string,
) =>
  href(`/admin/g/${encodeURIComponent(id)}`, [
    ["tab", withoutDatos(tab)],
    [DEVICE_PARAM, device],
  ]);
