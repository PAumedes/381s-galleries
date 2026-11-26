import { Form, useNavigation } from "react-router";

import { useT } from "../i18n/use-t";
import { isDarkPalette, type Palette } from "../lib/design";
import type { PinStep } from "../lib/server/access";
import { Logo } from "./Logo";

/**
 * The PIN gate (T6.54). One field; the label says which PIN it wants (the
 * client's first, then the album's own) and, after the first step, that it was
 * accepted. Every refused attempt answers visibly: an announced error that
 * carries the attempt number, the field cleared, refocused and shaken (a
 * static error style under reduced motion), and a pending submit button. The
 * attempt number rides in a hidden field, so it works without JavaScript too:
 * the error page is the server's answer, `autofocus` and the CSS animation
 * need no script. Keys on the attempt re-mount the field and the message, so
 * the shake restarts and a screen reader announces each attempt again.
 */
export function PinScreen({
  title,
  error,
  attempt = 0,
  step = "album",
  clientAccepted = false,
  palette = "claro",
}: {
  title: string;
  error?: string;
  /** Number of refused attempts so far (0 before the first). */
  attempt?: number;
  step?: PinStep;
  clientAccepted?: boolean;
  palette?: Palette;
}) {
  const t = useT();
  const nav = useNavigation();
  const checking = nav.state !== "idle" && nav.formData !== undefined;
  const label = t(step === "client" ? "pin.label.client" : "pin.label.album");
  return (
    <main
      data-page=""
      data-theme={palette}
      className="bg-paper text-ink flex min-h-dvh flex-col items-center justify-center gap-10 px-6 text-center"
    >
      <Logo
        variant={isDarkPalette(palette) ? "light" : "dark"}
        className="h-16"
      />
      <h1 className="text-display text-ink">{title}</h1>
      <Form
        method="post"
        className="flex w-full max-w-xs flex-col items-stretch gap-4"
      >
        <input type="hidden" name="attempt" value={attempt} />
        {clientAccepted && !error && (
          <p role="status" className="text-small text-grey-600">
            {t("pin.accepted")}
          </p>
        )}
        <div
          key={`${step}:${attempt}`}
          data-pin-shake={error ? "" : undefined}
          className={`flex flex-col gap-2 ${error ? "pin-shake" : ""}`}
        >
          <label
            htmlFor="pin"
            className="text-micro-label text-grey-600 uppercase"
          >
            {label}
          </label>
          <input
            id="pin"
            name="pin"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            // The gate is the page's one task: after a refused PIN or the first step, type again at once
            autoFocus={!!error || clientAccepted}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "pin-error" : undefined}
            className="text-body border-grey-300 focus:border-ink aria-invalid:border-ink aria-invalid:bg-grey-100 h-11 border-b bg-transparent px-1 text-center tracking-[0.3em] aria-invalid:border-b-2"
          />
        </div>
        {error && (
          <p
            key={attempt}
            id="pin-error"
            role="alert"
            className="text-small text-ink"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={checking}
          aria-busy={checking || undefined}
          className="text-micro-label bg-ink text-paper duration-base ease-out-soft hover:bg-grey-800 h-11 uppercase transition-colors disabled:opacity-60"
        >
          {checking ? t("pin.checking") : t("pin.submit")}
        </button>
      </Form>
    </main>
  );
}
