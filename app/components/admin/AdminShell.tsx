import { NavLink } from "react-router";

import { useFormat } from "../../i18n/use-format";
import { useT } from "../../i18n/use-t";
import type { MessageKey } from "../../i18n/t";
import { fmtBa } from "../../lib/ba-time";
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

/** "2026-11-16T13:00:00Z" -> "16/11/2026 10:00" (Buenos Aires time, Spanish format). */
export function fmtTime(iso: string): string {
  return fmtBa(iso) || iso;
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
  const link = ({ isActive }: { isActive: boolean }) =>
    `text-micro uppercase px-3 py-2 ${isActive ? "bg-ink text-paper" : "text-grey-700 hover:text-ink"}`;
  return (
    <div className="bg-paper text-ink min-h-dvh md:flex">
      <aside className="border-grey-200 flex flex-col gap-4 border-b p-4 md:min-h-dvh md:w-64 md:shrink-0 md:gap-8 md:border-r md:border-b-0 md:p-6">
        <div className="flex items-center justify-between md:block">
          <a href="/admin" aria-label={t("admin.nav.label")}>
            <Logo variant="dark" className="h-8" />
          </a>
          <nav
            aria-label={t("admin.nav.label")}
            className="flex gap-1 md:mt-8 md:flex-col"
          >
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={link}>
                {t(n.label)}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex flex-col gap-4">
          <StatusLine status={status} />
          <AdminLangToggle />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
