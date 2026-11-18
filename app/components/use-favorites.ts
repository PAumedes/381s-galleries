import { useCallback, useEffect, useRef, useState } from "react";

import { EmailRequiredError, useVisitor, type Visitor } from "./use-visitor";

const JSON_HEADERS = { "Content-Type": "application/json" };

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
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const {
    visitor,
    setVisitor,
    markKnown,
    ensure,
    gateOpen,
    submitGate,
    closeGate,
  } = useVisitor(slug, requireEmail);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });
  const flashError = useCallback(() => onErrorRef.current?.(), []);
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
        };
        setVisitor(body.visitor);
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
  }, [base, setVisitor, offline]);

  const send = useCallback(
    async (photoId: string, on: boolean): Promise<"ok" | "email" | "fail"> => {
      touched.current.add(photoId);
      setIds((cur) => {
        const next = new Set(cur);
        if (on) next.add(photoId);
        else next.delete(photoId);
        return next;
      });
      const rollback = () =>
        setIds((cur) => {
          // Only undo if nobody toggled it again meanwhile.
          if (cur.has(photoId) !== on) return cur;
          const next = new Set(cur);
          if (on) next.delete(photoId);
          else next.add(photoId);
          return next;
        });
      try {
        const res = await fetch(`${base}/favorites`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ photoId, on }),
        });
        if (res.ok) {
          markKnown();
          return "ok";
        }
        rollback();
        if (res.status === 403) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (body?.error === "email_required") return "email";
        }
        return "fail";
      } catch {
        rollback();
        return "fail";
      }
    },
    [base, markKnown],
  );

  const toggle = useCallback(
    (photoId: string) => {
      const on = !ids.has(photoId);
      if (offline) {
        setIds((cur) => {
          const next = new Set(cur);
          if (on) next.add(photoId);
          else next.delete(photoId);
          return next;
        });
        return Promise.resolve();
      }
      return ensure(async () => {
        const r = await send(photoId, on);
        if (r === "email") throw new EmailRequiredError();
        if (r === "fail") flashError();
      });
    },
    [ids, ensure, send, flashError, offline],
  );

  return {
    ids,
    visitor,
    gateOpen,
    toggle,
    submitGate,
    closeGate,
    ensure,
  };
}
