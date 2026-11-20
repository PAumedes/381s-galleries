import { nowIso } from "../../db";

type LimitEnv = Pick<Env, "DB">;

/** One named limit: row scope, hits allowed per window, window length. */
export type RateRule = {
  readonly scope: string;
  readonly max: number;
  readonly windowMs: number;
};

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
  // Prune with a cutoff of at least 10 minutes: some scopes (e.g. dlj:) use
  // per-key windows shorter than their siblings', and pruning with a short
  // window would reset other keys' live counters.
  const pruneCutoff = nowIso(
    new Date(Date.now() - Math.max(windowMs, 10 * 60 * 1000)),
  );
  if (Math.random() < 0.01) {
    await env.DB.prepare(
      "DELETE FROM rate_limits WHERE key LIKE ?1 AND window_start <= ?2",
    )
      .bind(`${scope}:%`, pruneCutoff)
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

/**
 * Give back one hit (never below 0). Used to refund a gallery-wide attempt
 * that turned out to be a correct PIN, so only wrong guesses consume it.
 */
export async function refundRateLimit(
  env: LimitEnv,
  scope: string,
  key: string,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE rate_limits SET count = count - 1 WHERE key = ?1 AND count > 0",
  )
    .bind(`${scope}:${key}`)
    .run();
}

/** Whole seconds (>= 1) until the counter's current window ends. */
export async function retryAfterSeconds(
  env: LimitEnv,
  scope: string,
  key: string,
  windowMs: number,
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT window_start FROM rate_limits WHERE key = ?1",
  )
    .bind(`${scope}:${key}`)
    .first<{ window_start: string }>();
  const start = row ? Date.parse(row.window_start) : NaN;
  const left = Number.isNaN(start) ? windowMs : start + windowMs - Date.now();
  return Math.max(1, Math.ceil(left / 1000));
}

/**
 * Count one hit of `key` against `rule`; true while within `rule.max`.
 * `windowMs` overrides the rule's window for keys with their own lifetime
 * (e.g. a download token's TTL).
 */
export function hit(
  env: LimitEnv,
  rule: RateRule,
  key: string,
  windowMs: number = rule.windowMs,
): Promise<boolean> {
  return rateLimit(env, rule.scope, key, rule.max, windowMs);
}

/** `retryAfterSeconds` for a rule (same optional per-key window as `hit`). */
export function retryAfterFor(
  env: LimitEnv,
  rule: RateRule,
  key: string,
  windowMs: number = rule.windowMs,
): Promise<number> {
  return retryAfterSeconds(env, rule.scope, key, windowMs);
}
