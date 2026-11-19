import type { ReactNode } from "react";

import { NAV_ZONE } from "./styles";

export function NavZone({
  side,
  label,
  enabled,
  onClick,
  children,
}: {
  side: "left" | "right";
  label: string;
  enabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${NAV_ZONE} ${side}-0`}
      aria-label={label}
      disabled={!enabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
