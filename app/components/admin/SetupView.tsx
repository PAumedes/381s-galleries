import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";

import { logoSource } from "../Logo";
import { useFormat } from "../../i18n/use-format";
import { useT } from "../../i18n/use-t";

export interface SetupViewData {
  connected: boolean;
  mock: boolean;
  rootName: string | null;
  studioName: string;
  lastSyncAt: string | null;
  /** Photos whose R2 cache is warm vs visible photos. */
  cacheWarm?: { warmed: number; total: number };
  /** Versions of the uploaded logos (null = bundled). */
  logo?: { onLight: string | null; onDark: string | null };
  lastError: { at: string; message: string } | null;
  /** Deleted galleries' Drive folders that sync skips (only id + date are kept). */
  ignoredFolders?: { driveFolderId: string; deletedAt: string }[];
}

export interface SetupActionData {
  intent: string;
  ok: boolean;
  error?: string;
  message?: string;
  result?: {
    skipped?: string;
    galleries: { created: number; updated: number; archived: number };
    photos: { added: number; updated: number; removed: number };
    issues: number;
  };
}

const btn =
  "text-micro uppercase border border-ink px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const btnPrimary = `${btn} bg-ink text-paper`;
const input =
  "border-grey-300 bg-white w-full border px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-grey-200 flex min-w-0 flex-col gap-3 border p-5">
      <h2 className="text-micro uppercase text-grey-700">{title}</h2>
      {children}
    </section>
  );
}

function Feedback({
  data,
  intent,
}: {
  data: SetupActionData | undefined;
  intent: string;
}) {
  if (!data || data.intent !== intent) return null;
  if (!data.ok)
    return (
      <p role="alert" className="border-ink border p-3 text-small">
        {data.error}
      </p>
    );
  return data.message ? (
    <p role="status" className="text-small text-grey-700">
      {data.message}
    </p>
  ) : null;
}

function SyncSummary({
  result,
}: {
  result: NonNullable<SetupActionData["result"]>;
}) {
  const t = useT();
  const { number } = useFormat();
  if (result.skipped === "no_root")
    return (
      <p role="status" className="text-small">
        {t("admin.setup.sync.noRoot")}
      </p>
    );
  if (result.skipped === "empty_root")
    return (
      <p role="status" className="text-small">
        {t("admin.setup.sync.emptyRoot")}
      </p>
    );
  if (result.skipped === "locked")
    return (
      <p role="status" className="text-small">
        {t("admin.setup.sync.locked")}
      </p>
    );
  return (
    <ul role="status" className="text-small text-grey-700">
      <li>
        {t("admin.setup.sync.galleries", {
          created: number(result.galleries.created),
          updated: number(result.galleries.updated),
          archived: number(result.galleries.archived),
        })}
      </li>
      <li>
        {t("admin.setup.sync.photos", {
          added: number(result.photos.added),
          updated: number(result.photos.updated),
          removed: number(result.photos.removed),
        })}
      </li>
      <li>{t("admin.setup.sync.issues", { n: number(result.issues) })}</li>
    </ul>
  );
}

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
  src: string;
  invert: boolean;
}) {
  const t = useT();
  return (
    <figure data-testid={testId} className="flex min-w-0 flex-col gap-1">
      <div
        className={`border-grey-300 flex h-28 items-center justify-center border p-3 ${dark ? "bg-black" : "bg-white"}`}
      >
        <img
          src={src}
          alt={t("admin.setup.logo.previewAlt")}
          className={`max-h-full max-w-full object-contain ${invert ? "brightness-0 invert" : ""}`}
          draggable={false}
        />
      </div>
      <figcaption className="text-small text-grey-600">{label}</figcaption>
    </figure>
  );
}

function LogoCard({
  logo,
  actionData,
  busy,
}: {
  logo: NonNullable<SetupViewData["logo"]>;
  actionData: SetupActionData | undefined;
  busy: boolean;
}) {
  const t = useT();
  const [pending, setPending] = useState<Pending>({});
  // Local blob: previews only. Each is revoked when its own slot is replaced
  // (never while still shown) and all of them on unmount.
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
  const custom = Boolean(logo.onLight || logo.onDark);
  const onLight = pending.onLight
    ? { src: pending.onLight, invert: false }
    : logoSource("dark", logo);
  const onDark = pending.onDark
    ? { src: pending.onDark, invert: false }
    : pending.onLight && !logo.onDark
      ? { src: pending.onLight, invert: true }
      : logoSource("light", logo);
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
      <Feedback data={actionData} intent="logoReset" />
    </section>
  );
}

export function SetupView({
  data,
  actionData,
}: {
  data: SetupViewData;
  actionData: SetupActionData | undefined;
}) {
  const t = useT();
  const { dateTime, number } = useFormat();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-title text-ink">{t("admin.setup.title")}</h1>

      <div
        data-testid="setup-cards"
        className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4"
      >
        <Section title={t("admin.setup.section.drive")}>
          <p className="text-body">
            {data.mock
              ? t("admin.setup.drive.demo")
              : data.connected
                ? t("admin.setup.drive.connected")
                : t("admin.setup.drive.notConnected")}
          </p>
          <div className="flex flex-wrap gap-2">
            {data.mock ? (
              <button type="button" className={btn} disabled>
                {t("admin.setup.connect")}
              </button>
            ) : (
              <a
                href="/admin/google/connect"
                className={`${btnPrimary} inline-block`}
              >
                {data.connected
                  ? t("admin.setup.reconnect")
                  : t("admin.setup.connect")}
              </a>
            )}
            {data.connected && !data.mock && (
              <Form method="post">
                <input type="hidden" name="intent" value="disconnect" />
                <button type="submit" className={btn} disabled={busy}>
                  {t("admin.setup.disconnect")}
                </button>
              </Form>
            )}
          </div>
          <Feedback data={actionData} intent="disconnect" />
        </Section>

        <Section title={t("admin.setup.section.root")}>
          <p className="text-body">
            {data.rootName ? (
              <>
                {t("admin.setup.root.current")} <strong>{data.rootName}</strong>
              </>
            ) : (
              t("admin.setup.root.none")
            )}
          </p>
          <Form
            method="post"
            className="flex flex-col gap-3"
            onSubmit={(ev) => {
              if (
                data.rootName &&
                !window.confirm(t("admin.setup.root.confirm"))
              )
                ev.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="root" />
            {data.rootName && <input type="hidden" name="confirm" value="1" />}
            <label className="text-small flex flex-col gap-1">
              {t("admin.setup.root.label")}
              <input
                name="folder"
                required
                maxLength={300}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://drive.google.com/drive/folders/…"
                className={input}
              />
            </label>
            <p className="text-small text-grey-600">
              {t("admin.setup.root.note")}
            </p>
            <div>
              <button type="submit" className={btnPrimary} disabled={busy}>
                {t("admin.setup.root.save")}
              </button>
            </div>
          </Form>
          <Feedback data={actionData} intent="root" />
        </Section>

        <Section title={t("admin.setup.section.sync")}>
          <p className="text-small text-grey-700">
            {data.lastSyncAt
              ? t("admin.status.lastSync", { time: dateTime(data.lastSyncAt) })
              : t("admin.status.neverSynced")}
          </p>
          {data.cacheWarm && (
            <p data-testid="cache-warm" className="text-small text-grey-700">
              {t("admin.setup.sync.cache", {
                warmed: number(data.cacheWarm.warmed),
                total: number(data.cacheWarm.total),
              })}
            </p>
          )}
          {data.lastError && (
            <p role="alert" className="text-small">
              {t("admin.setup.sync.lastError", {
                time: dateTime(data.lastError.at),
                message: data.lastError.message,
              })}
            </p>
          )}
          <Form method="post">
            <input type="hidden" name="intent" value="sync" />
            <button type="submit" className={btnPrimary} disabled={busy}>
              {busy && nav.formData?.get("intent") === "sync"
                ? t("admin.setup.sync.syncing")
                : t("admin.setup.sync.now")}
            </button>
          </Form>
          <Feedback data={actionData} intent="sync" />
          {actionData?.intent === "sync" &&
            actionData.ok &&
            actionData.result && <SyncSummary result={actionData.result} />}
        </Section>

        <Section title={t("admin.setup.section.brand")}>
          <Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="studio" />
            <label className="text-small flex flex-col gap-1">
              {t("admin.setup.brand.name")}
              <input
                name="studioName"
                required
                minLength={1}
                maxLength={60}
                defaultValue={data.studioName}
                className={input}
              />
            </label>
            <div>
              <button type="submit" className={btnPrimary} disabled={busy}>
                {t("admin.setup.brand.save")}
              </button>
            </div>
          </Form>
          <Feedback data={actionData} intent="studio" />
        </Section>
      </div>

      <LogoCard
        logo={data.logo ?? { onLight: null, onDark: null }}
        actionData={actionData}
        busy={busy}
      />

      <Section title={t("admin.setup.section.ignored")}>
        <p className="text-small text-grey-600">
          {t("admin.setup.ignored.note")}
        </p>
        {(data.ignoredFolders ?? []).length === 0 ? (
          <p className="text-small">{t("admin.setup.ignored.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(data.ignoredFolders ?? []).map((f) => (
              <li key={f.driveFolderId} className="flex flex-col gap-1">
                <span className="text-small break-all">{f.driveFolderId}</span>
                <span className="text-small text-grey-600">
                  {t("admin.setup.ignored.deletedAt", {
                    date: dateTime(f.deletedAt),
                  })}
                </span>
                <Form
                  method="post"
                  onSubmit={(ev) => {
                    if (!window.confirm(t("admin.setup.ignored.confirm")))
                      ev.preventDefault();
                  }}
                >
                  <input type="hidden" name="intent" value="reinclude" />
                  <input type="hidden" name="confirm" value="1" />
                  <input type="hidden" name="folder" value={f.driveFolderId} />
                  <button type="submit" className={btn} disabled={busy}>
                    {t("admin.setup.ignored.reinclude")}
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}
        <Feedback data={actionData} intent="reinclude" />
      </Section>
    </div>
  );
}
