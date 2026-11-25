import { useCallback, useRef, useState } from "react";

import type { GateResult } from "./EmailGate";

export type Visitor = { email: string; name: string | null } | null;

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Throw from an `ensure` action when the server answered `email_required`. */
export class EmailRequiredError extends Error {
  constructor() {
    super("email_required");
  }
}

type GateAction = () => void | Promise<void>;

/** Runs `action` now, or parks it behind the gate; an `EmailRequiredError` from it re-opens the gate. */
async function runBehindGate(
  needsGate: boolean,
  openGate: (action: GateAction) => void,
  action: GateAction,
) {
  if (needsGate) return openGate(action);
  try {
    await action();
  } catch (err) {
    if (err instanceof EmailRequiredError) return openGate(action);
    throw err;
  }
}

/** Saves the visitor's email (and name) for this gallery; "invalid" when the server rejects the email. */
async function postVisitor(
  base: string,
  email: string,
  name: string,
): Promise<"ok" | "invalid" | "error"> {
  try {
    const res = await fetch(`${base}/visitor`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(name ? { email, name } : { email }),
    });
    if (res.status === 400) return "invalid";
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

/**
 * The email gate for one gallery. `ensure(action)` runs `action` right away
 * when no email is needed (or one is already known); otherwise it parks the
 * action, opens the gate, and runs it once `submitGate` succeeds. An action
 * that throws `EmailRequiredError` (server said so) re-opens the gate too.
 * `setVisitor`/`markKnown` let the caller report what the server already knows.
 */
export function useVisitor(slug: string, requireEmail: boolean) {
  const base = `/api/g/${encodeURIComponent(slug)}`;
  const [visitor, setVisitorState] = useState<Visitor>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const known = useRef(false);
  const pending = useRef<GateAction | null>(null);

  const setVisitor = useCallback((v: Visitor) => {
    setVisitorState(v);
    // An anonymous server-side visitor reports `null`: not a known email.
    known.current = v !== null;
  }, []);
  const markKnown = useCallback(() => {
    known.current = true;
  }, []);

  const openGate = useCallback((action: GateAction) => {
    pending.current = action;
    setGateOpen(true);
  }, []);

  const ensure = useCallback(
    (action: GateAction) =>
      runBehindGate(requireEmail && !known.current, openGate, action),
    [requireEmail, openGate],
  );

  const submitGate = useCallback(
    async (email: string, name: string): Promise<GateResult> => {
      const sent = await postVisitor(base, email, name);
      if (sent !== "ok") return sent;
      // The server never echoes stored data; show what was just typed.
      setVisitor({ email, name: name || null });
      known.current = true;
      setGateOpen(false);
      const action = pending.current;
      pending.current = null;
      if (action) await action();
      return "ok";
    },
    [base, setVisitor],
  );

  const closeGate = useCallback(() => {
    pending.current = null;
    setGateOpen(false);
  }, []);

  return {
    visitor,
    setVisitor,
    markKnown,
    ensure,
    gateOpen,
    submitGate,
    closeGate,
  };
}
