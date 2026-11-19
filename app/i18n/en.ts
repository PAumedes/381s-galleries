import type { es } from "./es";
import { enAdmin } from "./en.admin";
import { enPublic } from "./en.public";

/** Every message, admin included. Public client code must import enPublic instead. */
export const en = { ...enPublic, ...enAdmin } as const satisfies Record<
  keyof typeof es,
  string
>;
