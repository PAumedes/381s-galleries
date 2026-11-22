/**
 * Counts the D1 queries made through an `Env` (one per prepared statement,
 * which is how Workers Free meters them: 50 per invocation, d1-limits.ts).
 * Meters nest: a metered env wrapped again counts in both.
 */
export interface D1Meter {
  /** Use this instead of the original env. */
  env: Env;
  used(): number;
}

/** A cap on the D1 queries (`used()` counts them all) one run may make. */
export interface D1Allowance {
  used(): number;
  budget: number;
}

export function meterD1(env: Env): D1Meter {
  let n = 0;
  const DB = new Proxy(env.DB, {
    get(target, prop) {
      const value = (target as never)[prop];
      if (prop === "prepare")
        return (sql: string) => {
          n++;
          return (value as (s: string) => unknown).call(target, sql);
        };
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return { env: { ...env, DB } as Env, used: () => n };
}
