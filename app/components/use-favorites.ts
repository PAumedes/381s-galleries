import { useCallback, useEffect, useRef, useState } from "react";

import { EmailRequiredError, useVisitor, type Visitor } from "./use-visitor";

const JSON_HEADERS = { "Content-Type": "application/json" };

type SendResult = "ok" | "email" | "fail";

/** The visitor's own approvals, as the favorites list delivers them (versioned albums only; T6.53f). */
export type ServerApprovals = { id: string; ver: number }[] | null;

/** A copy of `cur` with `id` present (`on`) or absent. */
function withMember(cur: ReadonlySet<string>, id: string, on: boolean) {
  const next = new Set(cur);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

/**
 * POSTs one favourite change. `onOk` / `onReject` run at the moment the
 * outcome is known (before any body parsing), so the UI settles first.
 */
async function postFavorite(
  base: string,
  photoId: string,
  on: boolean,
  { onOk, onReject }: { onOk: () => void; onReject: () => void },
): Promise<SendResult> {
  try {
    const res = await fetch(`${base}/favorites`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ photoId, on }),
    });
    if (res.ok) {
      onOk();
      return "ok";
    }
    onReject();
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (body?.error === "email_required") return "email";
    }
    return "fail";
  } catch {
    onReject();
    return "fail";
  }
}

/**
 * The favourite ids: loaded once from the server (and again if the gallery
 * changes), changed optimistically by `send`, which rolls back on refusal.
 * Toggles made while the load is in flight win over its reply.
 */
function useFavoriteIds(
  base: string,
  offline: boolean,
  setVisitor: (v: Visitor) => void,
  markKnown: () => void,
  setApprovals: (list: ServerApprovals) => void,
) {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const touched = useRef(new Set<string>());

  useEffect(() => {
    if (offline) return;
    const ctl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${base}/favorites`, { signal: ctl.signal });
        if (!res.ok) return;
        const body = (await res.json()) as {
          visitor: Visitor;
          favorites: string[];
          approvals?: ServerApprovals;
        };
        setVisitor(body.visitor);
        setApprovals(body.approvals ?? null);
        // Do not clobber toggles made while this request was in flight.
        setIds((cur) => {
          const next = new Set(body.favorites);
          for (const id of touched.current) {
            if (cur.has(id)) next.add(id);
            else next.delete(id);
          }
          return next;
        });
      } catch {
        /* favourites are optional: stay empty */
      }
    })();
    return () => ctl.abort();
  }, [base, setVisitor, setApprovals, offline]);

  const send = useCallback(
    (photoId: string, on: boolean): Promise<SendResult> => {
      touched.current.add(photoId);
      setIds((cur) => withMember(cur, photoId, on));
      // Only undo if nobody toggled it again meanwhile.
      const rollback = () =>
        setIds((cur) =>
          cur.has(photoId) !== on ? cur : withMember(cur, photoId, !on),
        );
      return postFavorite(base, photoId, on, {
        onOk: markKnown,
        onReject: rollback,
      });
    },
    [base, markKnown],
  );
  return { ids, setIds, send };
}

/**
 * Favourites for one gallery. Loaded client-side (page HTML stays cacheable),
 * toggled optimistically with rollback. The email gate comes from
 * `useVisitor`: a favourite that needs an email completes after `submitGate`.
 */
/** `onError` is called when a favourite could not be saved (the change is rolled back). */
export function useFavorites(
  slug: string,
  requireEmail: boolean,
  onError?: () => void,
  /** Admin preview: favourites live in memory only (no API calls, no visitor). */
  offline = false,
) {
  const base = `/api/g/${encodeURIComponent(slug)}`;
  const {
    visitor,
    setVisitor,
    markKnown,
    ensure,
    gateOpen,
    submitGate,
    closeGate,
  } = useVisitor(slug, requireEmail);
  const [serverApprovals, setApprovals] = useState<ServerApprovals>(null);
  const { ids, setIds, send } = useFavoriteIds(
    base,
    offline,
    setVisitor,
    markKnown,
    setApprovals,
  );
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });
  const flashError = useCallback(() => onErrorRef.current?.(), []);

  const toggle = useCallback(
    (photoId: string) => {
      const on = !ids.has(photoId);
      if (offline) {
        setIds((cur) => withMember(cur, photoId, on));
        return Promise.resolve();
      }
      return ensure(async () => {
        const r = await send(photoId, on);
        if (r === "email") throw new EmailRequiredError();
        if (r === "fail") flashError();
      });
    },
    [ids, ensure, send, flashError, offline, setIds],
  );

  return {
    ids,
    visitor,
    gateOpen,
    toggle,
    submitGate,
    closeGate,
    ensure,
    serverApprovals,
  };
}
