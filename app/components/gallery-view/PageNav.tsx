import type { ReactNode } from "react";
import { useRef } from "react";

import { isDarkPalette } from "../../lib/design";
import { TopBarActions } from "../GalleryTopBar";
import { Logo } from "../Logo";
import { SetTabs, type SetTab } from "../SetTabs";
import { useTabEdges } from "../use-gallery-chrome";
import type { OpenGallery } from "../types";
import { FAV } from "./tabs";

/** Sticky top bar: logo, set tabs, bulk download / favourites / share. */
export function PageNav({
  gallery,
  hidden,
  tabs,
  active,
  favCount,
  showBulk,
  downloadSlot,
  shareTitle,
  onSelect,
  onToggleFavs,
  onBulk,
  onCopied,
}: {
  gallery: OpenGallery;
  hidden: boolean;
  tabs: readonly SetTab[];
  active: string;
  favCount: number;
  showBulk: boolean;
  downloadSlot?: ReactNode;
  shareTitle: string | null;
  onSelect: (key: string) => void;
  onToggleFavs: () => void;
  onBulk: () => void;
  onCopied: () => void;
}) {
  const tabsRef = useRef<HTMLElement>(null);
  const { edges, updateEdges } = useTabEdges(tabsRef, active);
  return (
    <nav
      className={`bg-paper/80 duration-base ease-out-soft sticky top-0 z-(--z-topbar) grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4 backdrop-blur transition-transform ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <Logo
        variant={isDarkPalette(gallery.palette) ? "light" : "dark"}
        className="hidden h-7 min-w-0 justify-self-start overflow-hidden sm:block"
      />
      <SetTabs
        tabs={tabs}
        active={active}
        tabsRef={tabsRef}
        edges={edges}
        onScroll={updateEdges}
        onSelect={onSelect}
      />
      <TopBarActions
        downloadSlot={downloadSlot}
        showBulk={showBulk}
        onBulk={onBulk}
        favOn={active === FAV}
        hasFavs={favCount > 0}
        onToggleFavs={onToggleFavs}
        shareTitle={shareTitle}
        onCopied={onCopied}
      />
    </nav>
  );
}
