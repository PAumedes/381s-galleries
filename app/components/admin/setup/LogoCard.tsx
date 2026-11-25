import { useEffect, useState } from "react";
import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import { useStudioName } from "../../../lib/use-studio-name";
import { logoSource, Wordmark } from "../../Logo";
import type { SetupActionData, SetupViewData } from "./types";
import { btn, btnPrimary, Feedback, input } from "./ui";

const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

type Pending = { onLight?: string; onDark?: string };

function LogoUploadForm({
  variant,
  label,
  onPick,
  busy,
}: {
  variant: "on-light" | "on-dark";
  label: string;
  onPick: (file: File | undefined) => void;
  busy: boolean;
}) {
  const t = useT();
  return (
    <Form
      method="post"
      encType="multipart/form-data"
      className="flex min-w-0 flex-col gap-3"
    >
      <input type="hidden" name="intent" value="logo" />
      <input type="hidden" name="variant" value={variant} />
      <label className="text-small flex flex-col gap-1">
        {label}
        <input
          type="file"
          name="file"
          required
          accept={LOGO_ACCEPT}
          onChange={(ev) => onPick(ev.currentTarget.files?.[0])}
          className={input}
        />
      </label>
      <div>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {t("admin.setup.logo.upload")}
        </button>
      </div>
    </Form>
  );
}

/** Swatch content when nothing is uploaded: the name as text. */
const NO_LOGO = { src: null, invert: false };

function Swatch({
  testId,
  label,
  dark,
  src,
  invert,
}: {
  testId: string;
  label: string;
  dark: boolean;
  src: string | null;
  invert: boolean;
}) {
  const t = useT();
  const studio = useStudioName();
  return (
    <figure data-testid={testId} className="flex min-w-0 flex-col gap-1">
      <div
        className={`border-grey-300 flex h-28 items-center justify-center border p-3 ${dark ? "bg-black" : "bg-white"}`}
      >
        {src ? (
          <img
            src={src}
            alt={t("admin.setup.logo.previewAlt")}
            className={`max-h-full max-w-full object-contain ${invert ? "brightness-0 invert" : ""}`}
            draggable={false}
          />
        ) : (
          <Wordmark
            name={studio}
            variant={dark ? "light" : "dark"}
            className="h-12"
          />
        )}
      </div>
      <figcaption className="text-small text-grey-600">{label}</figcaption>
    </figure>
  );
}

type LogoData = NonNullable<SetupViewData["logo"]>;

/**
 * Local blob previews of the files just picked. Each is revoked when its own
 * slot is replaced (never while still shown) and all of them on unmount.
 */
function usePendingPreviews() {
  const [pending, setPending] = useState<Pending>({});
  const [urls] = useState<Pending>(() => ({}));
  useEffect(() => {
    return () => {
      for (const u of Object.values(urls)) if (u) URL.revokeObjectURL(u);
    };
  }, [urls]);
  const pick = (key: keyof Pending) => (file: File | undefined) => {
    const old = urls[key];
    if (old) URL.revokeObjectURL(old);
    urls[key] = file ? URL.createObjectURL(file) : undefined;
    setPending({ ...urls });
  };
  return { pending, pick };
}

/** What each swatch shows: the picked file, else (dark) the picked light logo inverted, else the saved one. */
function swatchSources(logo: LogoData, pending: Pending) {
  const onLight = pending.onLight
    ? { src: pending.onLight, invert: false }
    : (logoSource("dark", logo) ?? NO_LOGO);
  const onDark = pending.onDark
    ? { src: pending.onDark, invert: false }
    : pending.onLight && !logo.onDark
      ? { src: pending.onLight, invert: true }
      : (logoSource("light", logo) ?? NO_LOGO);
  return { onLight, onDark };
}

/** Back to the bundled logo, after a confirmation. */
function LogoResetForm({ custom, busy }: { custom: boolean; busy: boolean }) {
  const t = useT();
  return (
    <Form
      method="post"
      onSubmit={(ev) => {
        if (!window.confirm(t("admin.setup.logo.resetConfirm")))
          ev.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="logoReset" />
      <button type="submit" className={btn} disabled={busy || !custom}>
        {t("admin.setup.logo.reset")}
      </button>
    </Form>
  );
}

export function LogoCard({
  logo,
  actionData,
  busy,
}: {
  logo: LogoData;
  actionData: SetupActionData | undefined;
  busy: boolean;
}) {
  const t = useT();
  const { pending, pick } = usePendingPreviews();
  const custom = Boolean(logo.onLight || logo.onDark);
  const { onLight, onDark } = swatchSources(logo, pending);
  return (
    <section className="border-grey-200 flex min-w-0 flex-col gap-4 border p-5">
      <h2 className="text-micro uppercase text-grey-700">
        {t("admin.setup.section.logo")}
      </h2>
      <p className="text-small text-grey-600">{t("admin.setup.logo.hint")}</p>
      <p className="text-small text-grey-700">
        {custom ? t("admin.setup.logo.custom") : t("admin.setup.logo.default")}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Swatch
          testId="logo-preview-light"
          label={t("admin.setup.logo.previewLight")}
          dark={false}
          {...onLight}
        />
        <Swatch
          testId="logo-preview-dark"
          label={t("admin.setup.logo.previewDark")}
          dark
          {...onDark}
        />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <LogoUploadForm
          variant="on-light"
          label={t("admin.setup.logo.onLight")}
          onPick={pick("onLight")}
          busy={busy}
        />
        <LogoUploadForm
          variant="on-dark"
          label={t("admin.setup.logo.onDark")}
          onPick={pick("onDark")}
          busy={busy}
        />
      </div>
      <Feedback data={actionData} intent="logo" />
      <LogoResetForm custom={custom} busy={busy} />
      <Feedback data={actionData} intent="logoReset" />
    </section>
  );
}
