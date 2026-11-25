import { useState } from "react";

import type { PreviewDevice } from "../LivePreview";
import type { Focus } from "../use-focal-drag";
import type { MobileCover } from "./types";

type Size = { w: number; h: number };

/** Keeps a local copy of a server value, replaced when the server's changes. */
function useSynced(value: Focus | null) {
  const [local, setLocal] = useState<Focus | null>(value);
  const [seen, setSeen] = useState(value);
  if (seen?.x !== value?.x || seen?.y !== value?.y) {
    setSeen(value);
    setLocal(value);
  }
  return [local, setLocal] as const;
}

const aspectOf = (s: Size | undefined) => (s ? s.w / s.h : null);

/**
 * State of the cover editor: which device is shown, which cover the picker
 * edits (the mobile one only when it exists), the unsaved focal points and
 * the photo sizes (given, else measured by the picker).
 */
export function useCoverEditor({
  coverId,
  coverWidth,
  coverHeight,
  initialFocus,
  mobileCover,
  device: deviceProp,
  onDevice,
}: {
  coverId: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  initialFocus: Focus | null;
  mobileCover: MobileCover | null;
  device?: PreviewDevice;
  onDevice?: (d: PreviewDevice) => void;
}) {
  const [ownDevice, setOwnDevice] = useState<PreviewDevice>("desktop");
  const device = deviceProp ?? ownDevice;
  const setDevice = (d: PreviewDevice) => {
    setOwnDevice(d);
    onDevice?.(d);
  };
  const [focus, setFocus] = useSynced(initialFocus);
  const [mobileFocus, setMobileFocus] = useSynced(mobileCover?.focus ?? null);
  const [natural, setNatural] = useState<Record<string, Size>>({});

  const editing: "desktop" | "mobile" =
    device === "mobile" && mobileCover ? "mobile" : "desktop";
  const sizeOf = (id: string | null, w: number | null, h: number | null) =>
    w && h ? { w, h } : id ? natural[id] : undefined;
  const deskSize = sizeOf(coverId, coverWidth, coverHeight);
  const mobSize = mobileCover
    ? sizeOf(mobileCover.id, mobileCover.width, mobileCover.height)
    : undefined;
  return {
    device,
    setDevice,
    editing,
    pickId: editing === "mobile" ? mobileCover!.id : coverId,
    pickAspect: aspectOf(editing === "mobile" ? mobSize : deskSize),
    deskAspect: aspectOf(deskSize),
    mobileAspect: aspectOf(mobSize),
    focus,
    mobileFocus,
    cur: editing === "mobile" ? mobileFocus : focus,
    setCur: editing === "mobile" ? setMobileFocus : setFocus,
    onNatural: (id: string, size: Size) =>
      setNatural((n) =>
        n[id]?.w === size.w && n[id]?.h === size.h ? n : { ...n, [id]: size },
      ),
  };
}
