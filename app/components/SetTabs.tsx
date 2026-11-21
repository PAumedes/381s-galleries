import type { RefObject } from "react";

import { useT } from "../i18n/use-t";

export interface SetTab {
  key: string;
  label: string;
}

/** Scrollable row of set / favourites tabs in the gallery top bar. */
export function SetTabs({
  tabs,
  active,
  tabsRef,
  edges,
  onScroll,
  onSelect,
}: {
  tabs: readonly SetTab[];
  active: string;
  tabsRef: RefObject<HTMLElement | null>;
  /** Which edge has more tabs beyond it (fade mask). */
  edges: { start: boolean; end: boolean };
  onScroll: () => void;
  onSelect: (key: string) => void;
}) {
  const t = useT();
  if (tabs.length === 0) return <div aria-hidden="true" />;
  return (
    <nav
      ref={tabsRef}
      aria-label={t("gallery.sets")}
      onScroll={onScroll}
      style={{
        maskImage: `linear-gradient(to right, ${edges.start ? "transparent, #000 1.5rem" : "#000, #000 0"}, ${edges.end ? "#000 calc(100% - 1.5rem), transparent" : "#000 100%, #000"})`,
      }}
      className="flex min-w-0 snap-x snap-proximity items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-current={active === tab.key ? "true" : undefined}
          onClick={() => onSelect(tab.key)}
          className={`text-micro-label duration-base ease-out-soft min-h-11 shrink-0 snap-center border-b px-3 uppercase whitespace-nowrap transition-colors ${
            active === tab.key
              ? "border-ink text-ink"
              : "text-grey-600 hover:text-ink border-transparent"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
