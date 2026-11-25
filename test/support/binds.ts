/** `base` with a D1 that records the argument list of every `.bind(...)` call. */
export function capturingBindsEnv(base: Env) {
  const binds: unknown[][] = [];
  const DB = new Proxy(base.DB, {
    get(target, prop) {
      const v = (target as never)[prop];
      if (prop !== "prepare")
        return typeof v === "function"
          ? (v as (...a: unknown[]) => unknown).bind(target)
          : v;
      return (sql: string) => {
        const st = (v as (s: string) => D1PreparedStatement).call(target, sql);
        return new Proxy(st, {
          get(t, p) {
            const f = (t as never)[p];
            if (p !== "bind")
              return (f as (...a: unknown[]) => unknown).bind(t);
            return (...a: unknown[]) => {
              binds.push(a);
              return (f as (...x: unknown[]) => unknown).apply(t, a);
            };
          },
        });
      };
    },
  });
  return { e: { ...base, DB } as Env, binds };
}
