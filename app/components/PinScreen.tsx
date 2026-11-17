import { Form } from "react-router";

import { useT } from "../i18n/use-t";
import { Logo } from "./Logo";

export function PinScreen({
  title,
  error,
  theme = "light",
}: {
  title: string;
  error?: string;
  theme?: "light" | "dark";
}) {
  const t = useT();
  return (
    <main
      data-theme={theme === "dark" ? "dark" : undefined}
      className="bg-paper text-ink flex min-h-dvh flex-col items-center justify-center gap-10 px-6 text-center"
    >
      <Logo variant={theme === "dark" ? "light" : "dark"} className="h-16" />
      <h1 className="text-display text-ink">{title}</h1>
      <Form
        method="post"
        className="flex w-full max-w-xs flex-col items-stretch gap-4"
      >
        <label className="sr-only" htmlFor="pin">
          {t("pin.placeholder")}
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          required
          placeholder={t("pin.placeholder")}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "pin-error" : undefined}
          className="text-body border-grey-300 focus:border-ink h-11 border-b bg-transparent px-1 text-center tracking-[0.3em]"
        />
        {error && (
          <p id="pin-error" role="alert" className="text-small text-grey-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="text-micro-label bg-ink text-paper duration-base ease-out-soft hover:bg-grey-800 h-11 uppercase transition-colors"
        >
          {t("pin.submit")}
        </button>
      </Form>
    </main>
  );
}
