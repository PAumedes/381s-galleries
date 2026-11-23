/**
 * Touch-friendly control classes of the clients screens: 48px tall below md
 * (`data-compact` on the element opts out of the global 44px rule so these
 * win), the desktop density from md up. Inputs are 16px on phones through the
 * global admin rule.
 */
export const CLIENT_BTN =
  "text-micro uppercase border border-ink px-4 min-h-12 md:min-h-10 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
export const CLIENT_BTN_PRIMARY = `${CLIENT_BTN} bg-ink text-paper`;
export const CLIENT_INPUT =
  "border-grey-300 bg-white w-full min-w-0 border px-3 py-2 min-h-12 md:min-h-10 text-body aria-invalid:border-ink aria-invalid:border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
/** Long names and addresses wrap instead of widening the page. */
export const WRAP = "min-w-0 [overflow-wrap:anywhere]";
