import { esAdmin } from "./es.admin";
import { esHelp } from "./es.help";
import { esPublic } from "./es.public";

/** Every message, admin included. Public client code must import esPublic instead. */
export const es = { ...esPublic, ...esAdmin, ...esHelp } as const;
