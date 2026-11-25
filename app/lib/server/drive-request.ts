/**
 * The authenticated, retrying GET transport under the Drive client: bearer
 * token with one forced refresh on 401, backoff on 429/5xx/rate-limit 403 and
 * network errors, redacted error details. Counts every fetch (`subrequests`).
 */
import { DriveError } from "./drive-types";

export interface DriveClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_RETRIES = 3;
const MAX_ERROR_BODY = 4096;
const BASE_DELAY_MS = 500;
const MAX_RETRY_AFTER_MS = 30_000;

async function readCapped(res: Response, cap: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(Math.min(total, cap));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, buf.length - off);
    buf.set(part, off);
    off += part.length;
    if (off >= buf.length) break;
  }
  return new TextDecoder().decode(buf);
}

async function toError(res: Response, token: string): Promise<DriveError> {
  let detail: string | undefined;
  try {
    const text = await readCapped(res, MAX_ERROR_BODY);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (typeof j?.error?.message === "string") detail = j.error.message;
    } catch {
      // non-JSON body: no detail
    }
  } catch {
    // ignore body read failures
  }
  if (detail && token) detail = detail.split(token).join("[redacted]");
  return new DriveError(
    res.status,
    `Drive request failed (${res.status})`,
    detail,
  );
}

async function isRateLimit403(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    const j = (await res.clone().json()) as {
      error?: { errors?: { reason?: string }[]; status?: string };
    };
    return !!j.error?.errors?.some(
      (e) =>
        e.reason === "rateLimitExceeded" ||
        e.reason === "userRateLimitExceeded",
    );
  } catch {
    return false;
  }
}

function delayFor(attempt: number, res: Response): number {
  const exp = BASE_DELAY_MS * 2 ** attempt;
  const delay = exp + Math.random() * exp * 0.5;
  const ra = res.headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    let ms = Number.NaN;
    if (Number.isFinite(secs)) ms = secs * 1000;
    else {
      const when = Date.parse(ra);
      if (!Number.isNaN(when)) ms = when - Date.now();
    }
    if (Number.isFinite(ms) && ms > 0) {
      return Math.min(Math.max(ms, delay), MAX_RETRY_AFTER_MS);
    }
  }
  return delay;
}

/** The I/O a requester depends on, injectable for tests. */
interface Transport {
  getToken: (forceRefresh?: boolean) => Promise<string>;
  doFetch: NonNullable<DriveClientOptions["fetch"]>;
  sleep: (ms: number) => Promise<void>;
  /** Called once per outgoing subrequest. */
  count: () => void;
}

/** GET with token refresh on one 401 and bounded retries (network, 429, 5xx, rate-limit 403). */
async function requestWithRetry(
  tr: Transport,
  url: string,
  headers: Record<string, string> = {},
  streaming = false,
): Promise<Response> {
  let token = await tr.getToken();
  let refreshed = false;
  let retries = 0;
  for (;;) {
    let res: Response;
    try {
      tr.count();
      res = await tr.doFetch(url, {
        method: "GET",
        headers: { ...headers, Authorization: `Bearer ${token}` },
      });
    } catch {
      if (retries < MAX_RETRIES) {
        const exp = BASE_DELAY_MS * 2 ** retries;
        retries++;
        await tr.sleep(exp + Math.random() * exp * 0.5);
        continue;
      }
      throw new DriveError(503, "Drive request failed (network)");
    }
    if (res.ok) return res;
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      await res.body?.cancel().catch(() => {});
      token = await tr.getToken(true);
      continue;
    }
    if (streaming) throw await toError(res, token);
    const retryable =
      res.status === 429 || res.status >= 500 || (await isRateLimit403(res));
    if (retryable && retries < MAX_RETRIES) {
      const wait = delayFor(retries, res);
      retries++;
      await res.body?.cancel().catch(() => {});
      await tr.sleep(wait);
      continue;
    }
    throw await toError(res, token);
  }
}

export function createRequester(
  getToken: (forceRefresh?: boolean) => Promise<string>,
  opts: DriveClientOptions,
) {
  let subrequestCount = 0;
  const tr: Transport = {
    getToken,
    doFetch: opts.fetch ?? ((i, init) => fetch(i, init)),
    sleep:
      opts.sleep ??
      ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    count: () => void subrequestCount++,
  };
  const request = (
    url: string,
    headers: Record<string, string> = {},
    streaming = false,
  ) => requestWithRetry(tr, url, headers, streaming);

  async function json<T>(url: string): Promise<T> {
    const res = await request(url);
    try {
      return (await res.json()) as T;
    } catch {
      await res.body?.cancel().catch(() => {});
      throw new DriveError(502, "Drive returned an invalid response");
    }
  }

  return { request, json, subrequests: () => subrequestCount };
}
