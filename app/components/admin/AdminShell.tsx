import { NavLink } from "react-router";

import { Logo } from "../Logo";

export interface AdminStatus {
  mock: boolean;
  connected: boolean;
  lastSyncAt: string | null;
  lastError: { at: string; message: string } | null;
}

const NAV = [
  { to: "/admin", label: "Galerías", end: true },
  { to: "/admin/setup", label: "Ajustes", end: false },
];

/** "2026-11-16T10:00:00Z" -> "2026-11-16 10:00 UTC" (stable, no locale drift). */
export function fmtTime(iso: string): string {
  return iso.replace("T", " ").replace(/:\d\dZ$/, " UTC");
}

export function StatusLine({ status }: { status: AdminStatus }) {
  const ok = status.mock || status.connected;
  return (
    <div className="text-small text-grey-600 flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block size-2 ${ok ? "bg-ink" : "border-grey-500 border"}`}
        />
        {status.mock
          ? "Modo demo"
          : status.connected
            ? "Google conectado"
            : "Google sin conectar"}
      </span>
      <span>
        {status.lastSyncAt
          ? `Última sincronización: ${fmtTime(status.lastSyncAt)}`
          : "Sin sincronizar aún"}
      </span>
      {status.lastError && (
        <span role="alert" className="text-ink">
          Error de sincronización ({fmtTime(status.lastError.at)}):{" "}
          {status.lastError.message}
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
  const link = ({ isActive }: { isActive: boolean }) =>
    `text-micro uppercase px-3 py-2 ${isActive ? "bg-ink text-paper" : "text-grey-700 hover:text-ink"}`;
  return (
    <div className="bg-paper text-ink min-h-dvh md:flex">
      <aside className="border-grey-200 flex flex-col gap-4 border-b p-4 md:min-h-dvh md:w-64 md:shrink-0 md:gap-8 md:border-r md:border-b-0 md:p-6">
        <div className="flex items-center justify-between md:block">
          <a href="/admin" aria-label="Administración">
            <Logo variant="dark" className="h-8" />
          </a>
          <nav
            aria-label="Administración"
            className="flex gap-1 md:mt-8 md:flex-col"
          >
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={link}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <StatusLine status={status} />
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
