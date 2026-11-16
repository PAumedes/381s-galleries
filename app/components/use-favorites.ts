import { useCallback, useEffect, useRef, useState } from "react";

import type { GateResult } from "./EmailGate";

type Visitor = { email: string; name: string | null } | null;

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Favourites for one gallery. Loaded client-side (page HTML stays cacheable),
 * toggled optimistically with rollback. `gateOpen` is true while the email
 * gate must be shown; the pending favourite completes after `submitGate`.
 */
export function useFavorites(slug: string, requireEmail: boolean) {
  const base = `/api/g/${encodeURIComponent(slug)}`;
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const [visitor, setVisitor] = useState<Visitor>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const flashError = useCallback(() => {
    setFailed(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setFailed(false), 3000);
  }, []);
  const pending = useRef<string | null>(null);
  const hasVisitor = useRef(false);
  const touched = useRef(new Set<string>());

  useEffect(() => {
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
        // A signed-in visitor exists server-side even when anonymous (visitor null).
        hasVisitor.current = body.visitor !== null;
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
  }, [base]);

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
          hasVisitor.current = true;
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
    [base],
  );

  const toggle = useCallback(
    async (photoId: string) => {
      const on = !ids.has(photoId);
      if (requireEmail && !hasVisitor.current && !visitor) {
        pending.current = photoId;
        setGateOpen(true);
        return;
      }
      const r = await send(photoId, on);
      if (r === "email") {
        pending.current = photoId;
        setGateOpen(true);
      } else if (r === "fail") flashError();
    },
    [ids, requireEmail, visitor, send, flashError],
  );

  const submitGate = useCallback(
    async (email: string, name: string): Promise<GateResult> => {
      try {
        const res = await fetch(`${base}/visitor`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify(name ? { email, name } : { email }),
        });
        if (res.status === 400) return "invalid";
        if (!res.ok) return "error";
        const body = (await res.json()) as { visitor: Visitor };
        setVisitor(body.visitor);
        hasVisitor.current = true;
      } catch {
        return "error";
      }
      setGateOpen(false);
      const photoId = pending.current;
      pending.current = null;
      if (photoId) {
        const r = await send(photoId, true);
        if (r !== "ok") flashError();
      }
      return "ok";
    },
    [base, send, flashError],
  );

  const closeGate = useCallback(() => {
    pending.current = null;
    setGateOpen(false);
  }, []);

  return { ids, visitor, gateOpen, failed, toggle, submitGate, closeGate };
}
