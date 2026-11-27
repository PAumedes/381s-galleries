import { useState } from "react";

import type { TFunction } from "../../i18n/t";
import type { GalleryPhoto } from "../types";
import { shownVersion, type ApprovalsApi } from "../use-approvals";
import { BTN } from "./styles";

/** Pointer events inside the button belong to it, not to the swipe-to-close of the dialog. */
const keepHere = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * Versioned albums (T6.53f): "Approve v3" / "Approved in v3" for the version
 * the photo shows now (a toggle: `aria-pressed`). One instance per photo
 * (keyed by the caller). The live region speaks the STATE, so a refused change
 * that reverts is announced as the old state again (the page toast says why).
 */
export function ApproveButton({
  t,
  photo,
  chrome,
  approvals,
}: {
  t: TFunction;
  photo: GalleryPhoto;
  chrome: string;
  approvals: ApprovalsApi;
}) {
  const [touched, setTouched] = useState(false);
  const ver = shownVersion(photo);
  const approved = approvals.approvedAt(photo) !== null;
  const spoken = approved
    ? t("approvals.announceOn", { n: ver })
    : touched
      ? t("approvals.announceOff", { n: ver })
      : "";
  return (
    <div
      className={`absolute right-4 bottom-4 z-10 ${chrome}`}
      onPointerDown={keepHere}
      onPointerMove={keepHere}
      onPointerUp={keepHere}
      onPointerCancel={keepHere}
    >
      <button
        type="button"
        data-testid="approve"
        aria-pressed={approved}
        className={`${BTN} w-auto min-w-11 border border-white/60 px-3 text-micro uppercase aria-pressed:bg-white aria-pressed:text-black`}
        onClick={() => {
          setTouched(true);
          void approvals.toggle(photo);
        }}
      >
        {approved
          ? t("approvals.approved", { n: ver })
          : t("approvals.approve", { n: ver })}
      </button>
      <span role="status" data-testid="approve-live" className="sr-only">
        {spoken}
      </span>
    </div>
  );
}
