import type { es } from "./es";
import { enAdmin } from "./en.admin";
import { enHelp } from "./en.help";
import { enWizard } from "./en.wizard";
import { enPublic } from "./en.public";

/** Every message, admin included. Public client code must import enPublic instead. */
export const en = {
  ...enPublic,
  ...enAdmin,
  ...enHelp,
  ...enWizard,
} as const satisfies Record<keyof typeof es, string>;
