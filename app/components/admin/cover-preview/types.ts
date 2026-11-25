import type { Focus } from "../use-focal-drag";

export type MobileCover = {
  id: string;
  width: number | null;
  height: number | null;
  focus: Focus | null;
};
export type ChooserPhoto = { id: string; name: string };
