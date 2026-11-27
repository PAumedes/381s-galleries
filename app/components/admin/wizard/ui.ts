/**
 * Control classes of the wizard: 48px tall targets and 16px text on every
 * screen (the wizard is for someone doing this for the first time, often on a
 * phone). Focus rings come from the global admin rule plus these.
 */
const BASE =
  "inline-flex min-h-12 items-center justify-center border border-ink px-5 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40 disabled:cursor-not-allowed";
export const WIZ_BTN = `${BASE} text-ink hover:bg-ink hover:text-paper`;
export const WIZ_BTN_PRIMARY = `${BASE} bg-ink text-paper`;
/** A text link that is still a 48px target. */
export const WIZ_LINK =
  "inline-flex min-h-12 items-center text-base underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
export const WIZ_INPUT =
  "border-grey-400 bg-white text-ink min-h-12 w-full min-w-0 border px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink aria-invalid:border-ink aria-invalid:border-2";
/** Long names and addresses wrap instead of widening the page. */
export const WIZ_WRAP = "min-w-0 [overflow-wrap:anywhere]";
