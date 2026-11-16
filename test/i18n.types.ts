// Compiled by tsc (tsconfig.cloudflare.json); never executed.
import type { en } from "../app/i18n/en";
import type { es } from "../app/i18n/es";

type Dict = Record<keyof typeof es, string>;

// @ts-expect-error a missing key must fail
export const missing: Dict = {};

export const extra: Dict = {
  ...({} as Dict),
  // @ts-expect-error an extra key must fail
  notAKey: "x",
};

// the real en dictionary must be assignable to Dict (parity)
export const parity: Dict = {} as typeof en;
