import { nowIso } from "../../db";

type LimitEnv = Pick<Env, "DB">;

/**
 * The one fixed-window limiter, on the `rate_limits` table. Row key is
 * `<scope>:<key>` (scopes: `pin`, `visitor`, `anon`, later `dl`). Counts this
 * hit atomically and returns whether it is still within `max` for the window.
 * Expired rows of the same scope are pruned opportunistically.
 */
export async function rateLimit(
  env: LimitEnv,
  scope: string,
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const now = nowIso();
  const cutoff = nowIso(new Date(Date.now() - windowMs));
  if (Math.random() < 0.01) {
    await env.DB.prepare(
      "DELETE FROM rate_limits WHERE key LIKE ?1 AND window_start <= ?2",
    )
      .bind(`${scope}:%`, cutoff)
      .run();
  }
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
     RETURNING count`,
  )
    .bind(`${scope}:${key}`, now, cutoff)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= max;
}

/** Forget a counter (e.g. after a successful PIN entry). */
export async function resetRateLimit(
  env: LimitEnv,
  scope: string,
  key: string,
): Promise<void> {
  await env.DB.prepare("DELETE FROM rate_limits WHERE key = ?1")
    .bind(`${scope}:${key}`)
    .run();
}
