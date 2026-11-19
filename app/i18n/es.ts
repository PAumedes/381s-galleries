import { esAdmin } from "./es.admin";
import { esPublic } from "./es.public";

/** Every message, admin included. Public client code must import esPublic instead. */
export const es = { ...esPublic, ...esAdmin } as const;
