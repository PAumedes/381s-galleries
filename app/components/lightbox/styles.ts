const FOCUS =
  "focus-visible:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white";

export const BTN = `flex size-11 pointer-coarse:size-12 cursor-pointer items-center justify-center text-white/70 transition-colors duration-base ease-out-soft hover:text-white ${FOCUS} disabled:pointer-events-none disabled:opacity-25`;

// Previous/next: wide full-height side zones (15% of the width, 64px at
// least) that start below the top bar. Always clickable, even while the chrome
// is faded, and never pointer-events-none when disabled, so a click can't fall
// through to the backdrop and close the lightbox. On touch they become sr-only
// (still in the accessibility tree and the tab order) and phones swipe.
export const NAV_ZONE = `absolute inset-y-16 flex w-[15vw] min-w-16 cursor-pointer items-center justify-center text-white/70 transition-colors duration-base ease-out-soft hover:bg-white/10 hover:text-white focus-visible:bg-white/10 ${FOCUS} disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent pointer-coarse:sr-only pointer-coarse:min-w-0`;

// 24px icon, 28px on touch (the button grows to 48px there).
export const ICON = "size-6 pointer-coarse:size-7";
