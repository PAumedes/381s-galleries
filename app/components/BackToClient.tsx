import type { ReactNode } from "react";

import { useT } from "../i18n/use-t";
import { ChevronLeft } from "./icons";

export type BackToClientLink = { name: string; href: string };

/**
 * Quiet "‹ Client" link above the album cover (T6.50), only for a visitor who
 * came from that client's page. A strip in the flow, so it never overlaps the
 * cover's logo or title; the cover gives up the same 3rem so the first screen
 * still fits. Without a link the children render untouched.
 */
export function BackToClient({
  link,
  children,
}: {
  link?: BackToClientLink;
  children: ReactNode;
}) {
  const t = useT();
  if (!link) return <>{children}</>;
  return (
    <div className="[&>header]:h-[calc(100dvh-3rem)]">
      <div className="bg-paper text-grey-600 flex h-12 items-center px-4">
        <a
          href={link.href}
          aria-label={t("gallery.backToClient", { name: link.name })}
          className="text-micro-label hover:text-ink focus-visible:outline-ink -ms-2 inline-flex min-h-12 max-w-full min-w-0 items-center gap-1 px-2 uppercase focus-visible:outline-2"
        >
          <ChevronLeft className="size-5 shrink-0 rtl:-scale-x-100" />
          <span dir="auto" className="truncate">
            {link.name}
          </span>
        </a>
      </div>
      {children}
    </div>
  );
}
