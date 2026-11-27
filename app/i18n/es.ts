import { esAdmin } from "./es.admin";
import { esHelp } from "./es.help";
import { esWizard } from "./es.wizard";
import { esPublic } from "./es.public";

/** Every message, admin included. Public client code must import esPublic instead. */
export const es = { ...esPublic, ...esAdmin, ...esHelp, ...esWizard } as const;
