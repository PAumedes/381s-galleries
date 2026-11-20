const FOCUS =
  "focus-visible:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white";

// `phone:` = touch pointer OR viewport under 768px (see app.css).
export const BTN = `flex size-11 phone:size-14 cursor-pointer items-center justify-center text-white/70 transition-colors duration-base ease-out-soft hover:text-white ${FOCUS} disabled:pointer-events-none disabled:opacity-25`;

// Previous/next: wide full-height side zones (15% of the width, 64px at
// least) that start below the top bar. Always clickable, even while the chrome
// is faded, and never pointer-events-none when disabled, so a click can't fall
// through to the backdrop and close the lightbox. On phones they shrink to a
// 56px round button centred on the edge (the chevron inside carries the
// semi-transparent disc, see PHONE_DISC); the rest of the edge is a tap zone
// handled by the stage. Hidden (invisible) when there is nothing to go to.
export const NAV_ZONE = `absolute inset-y-16 flex w-[15vw] min-w-16 cursor-pointer items-center justify-center text-white/70 transition-colors duration-base ease-out-soft hover:bg-white/10 hover:text-white focus-visible:bg-white/10 ${FOCUS} disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent phone:inset-y-auto phone:top-1/2 phone:size-14 phone:min-w-0 phone:-translate-y-1/2 phone:hover:bg-transparent phone:disabled:invisible`;

// The visible part of a phone side button: dark disc, 28px chevron.
export const PHONE_DISC =
  "phone:size-14 phone:rounded-full phone:bg-black/35 phone:p-3.5";

// 24px icon, 32px on phones (the button grows to 56px there).
export const ICON = "size-6 phone:size-8";
