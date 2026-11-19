import { useEffect, useId, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";

import { useFormat } from "../../i18n/use-format";
import { useT } from "../../i18n/use-t";
import type { MessageKey } from "../../i18n/t";
import { fmtStudio } from "../../lib/studio-time";
import { Logo } from "../Logo";
import { AdminLangToggle } from "./AdminLangToggle";

export interface AdminStatus {
  mock: boolean;
  connected: boolean;
  lastSyncAt: string | null;
  lastError: { at: string; message: string } | null;
}

const NAV: { to: string; label: MessageKey; end: boolean }[] = [
  { to: "/admin", label: "admin.nav.galleries", end: true },
  { to: "/admin/setup", label: "admin.nav.settings", end: false },
];

/** "2026-11-16T13:00:00Z" -> "16/11/2026 10:00" (studio time, Spanish format). */
export function fmtTime(iso: string, tz?: string): string {
  return fmtStudio(iso, tz) || iso;
}

export function StatusLine({ status }: { status: AdminStatus }) {
  const t = useT();
  const { dateTime } = useFormat();
  const ok = status.mock || status.connected;
  return (
    <div className="text-small text-grey-600 flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block size-2 ${ok ? "bg-ink" : "border-grey-500 border"}`}
        />
        {status.mock
          ? t("admin.status.demo")
          : status.connected
            ? t("admin.status.connected")
            : t("admin.status.disconnected")}
      </span>
      <span>
        {status.lastSyncAt
          ? t("admin.status.lastSync", { time: dateTime(status.lastSyncAt) })
          : t("admin.status.neverSynced")}
      </span>
      {status.lastError && (
        <span role="alert" className="text-ink">
          {t("admin.status.syncError", {
            time: dateTime(status.lastError.at),
            message: status.lastError.message,
          })}
        </span>
      )}
    </div>
  );
}

export function AdminShell({
  status,
  children,
}: {
  status: AdminStatus;
  children: React.ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  // Phones: the menu closes after navigating and with Escape.
  const [openAt, setOpenAt] = useState(pathname);
  if (openAt !== pathname) {
    setOpenAt(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // The panel turns display:none below md; keep focus on the toggle.
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const link = ({ isActive }: { isActive: boolean }) =>
    `text-micro flex min-h-tap items-center px-3 uppercase md:min-h-0 md:py-2 ${isActive ? "bg-ink text-paper" : "text-grey-700 hover:text-ink"}`;
  return (
    <div className="bg-paper text-ink min-h-dvh md:flex" data-admin>
      <aside className="border-grey-200 flex flex-col border-b md:min-h-dvh md:w-64 md:shrink-0 md:border-r md:border-b-0 md:p-6">
        <div className="flex items-center justify-between px-4 py-2 md:block md:p-0">
          <a
            href="/admin"
            aria-label={t("admin.nav.label")}
            className="flex min-h-tap min-w-0 items-center overflow-hidden md:min-h-0"
          >
            <Logo variant="dark" className="h-8" />
          </a>
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className="text-micro border-grey-300 min-h-tap border px-4 uppercase md:hidden"
          >
            {t("admin.nav.menu")}
          </button>
        </div>
        <div
          id={panelId}
          className={`${open ? "flex" : "hidden"} flex-col gap-4 px-4 pb-4 md:mt-8 md:flex md:gap-8 md:p-0`}
        >
          <nav
            aria-label={t("admin.nav.label")}
            className="flex flex-col gap-1"
          >
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={link}
                onClick={() => setOpen(false)}
              >
                {t(n.label)}
              </NavLink>
            ))}
          </nav>
          <div className="flex flex-col gap-4">
            <StatusLine status={status} />
            <AdminLangToggle />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8 2xl:px-12">
        {/* Every admin screen shares one width: the whole desktop, capped on very wide screens. */}
        <div data-admin-content="" className="mx-auto w-full max-w-[96rem]">
          {children}
        </div>
      </main>
    </div>
  );
}
