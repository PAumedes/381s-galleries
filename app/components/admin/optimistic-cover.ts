import { useNavigation } from "react-router";

type CoverFields = {
  coverPhotoId: string | null;
  coverFocus: { x: number; y: number } | null;
  coverPhotoIdMobile?: string | null;
  coverFocusMobile?: { x: number; y: number } | null;
};

export type PendingCover = {
  device: "desktop" | "mobile";
  /** Photo being chosen; null = "automatic" / "no mobile cover". */
  photoId: string | null;
};

/**
 * The cover choice the admin has just submitted and the server has not
 * confirmed yet (React Router keeps the submitted form on the navigation until
 * the action and the reload finish), or null. Only a well-formed cover form
 * for a photo of this gallery counts; anything else is left to the server.
 */
export function usePendingCover(
  photoIds: ReadonlySet<string>,
  actionData?: { intent?: string; ok?: boolean },
  /** Prueba: photos without a preview-wm; the server drops them as mobile cover. */
  noWmIds?: ReadonlySet<string>,
): PendingCover | null {
  const nav = useNavigation();
  const form = nav.formData;
  if (!form || form.get("intent") !== "cover") return null;
  // The form stays on the navigation while the reload runs, but a failed
  // action has already answered: roll back now, next to the error.
  if (
    nav.state === "loading" &&
    actionData?.intent === "cover" &&
    actionData.ok === false
  )
    return null;
  const device = form.get("device");
  const photo = form.get("photoId");
  if (typeof photo !== "string") return null;
  if (device !== null && device !== "desktop" && device !== "mobile")
    return null;
  if (photo !== "" && !photoIds.has(photo)) return null;
  if (device === "mobile" && noWmIds?.has(photo)) return null;
  return {
    device: device === "mobile" ? "mobile" : "desktop",
    photoId: photo === "" ? null : photo,
  };
}

/**
 * The gallery as it will be once the pending cover save succeeds: the chosen
 * photo is the cover of that device and its focal point is back at the
 * center (what the server does). When the save fails the pending form goes
 * away and the loader's values are shown again (with the error).
 */
export function withPendingCover<G extends CoverFields>(
  g: G,
  pending: PendingCover | null,
): G {
  if (!pending) return g;
  return pending.device === "mobile"
    ? {
        ...g,
        coverPhotoIdMobile: pending.photoId,
        coverFocusMobile: null,
      }
    : { ...g, coverPhotoId: pending.photoId, coverFocus: null };
}
