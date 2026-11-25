import type { MouseEvent, ReactNode, Ref } from "react";

import { Logo } from "./Logo";
import { ChevronDown } from "./icons";

/** The pieces every cover layout arranges (built once by `CoverHero`). */
export type CoverParts = {
  headerRef?: Ref<HTMLElement>;
  /** Height classes: viewport-high on the public page, the box in previews. */
  box: string;
  /** ` img-protect` when proofing hides the photo from drag/save. */
  protect: string;
  noMenu?: (e: MouseEvent) => void;
  photo: ReactNode;
  shield: ReactNode;
  logo: ReactNode;
  titleBlock: ReactNode;
  scroll: { embedded: boolean; label: string; onScroll?: () => void };
  embedded: boolean;
};

export function DividedaCover({
  headerRef,
  box,
  protect,
  noMenu,
  photo,
  shield,
  logo,
  titleBlock,
  scroll,
}: CoverParts) {
  return (
    <header
      ref={headerRef}
      data-cover-layout="dividida"
      className={`@container bg-paper text-ink relative w-full overflow-hidden ${box}${protect}`}
      onContextMenu={noMenu}
    >
      <div className="flex size-full flex-col @3xl:flex-row">
        <div
          data-cover-pane="image"
          className="bg-night relative min-h-0 flex-3 overflow-hidden"
        >
          {photo}
          {shield}
        </div>
        <div
          data-cover-pane="text"
          className="bg-paper text-ink flex min-h-0 flex-2 flex-col items-center justify-between gap-6 px-6 py-6 text-center"
        >
          {logo}
          <div className="flex flex-col items-center gap-6">{titleBlock}</div>
          <ScrollCue {...scroll} className="text-grey-600 hover:text-ink" />
        </div>
      </div>
    </header>
  );
}

export function CentradaCover({
  headerRef,
  box,
  protect,
  noMenu,
  photo,
  shield,
  logo,
  titleBlock,
  scroll,
}: CoverParts) {
  return (
    <header
      ref={headerRef}
      data-cover-layout="centrada"
      className={`bg-paper text-ink relative flex w-full flex-col items-center gap-6 px-6 py-6 text-center sm:px-16 ${box}${protect}`}
      onContextMenu={noMenu}
    >
      {logo}
      <div
        data-cover-frame=""
        className="bg-grey-100 relative min-h-0 w-full max-w-6xl flex-1 overflow-hidden"
      >
        {photo}
        {shield}
      </div>
      <div className="flex flex-col items-center gap-4">
        {titleBlock}
        <ScrollCue {...scroll} className="text-grey-600 hover:text-ink" />
      </div>
    </header>
  );
}

export function MinimaCover({
  headerRef,
  embedded,
  logo,
  titleBlock,
}: CoverParts) {
  return (
    <header
      ref={headerRef}
      data-cover-layout="minima"
      className={`bg-paper text-ink relative flex w-full flex-col items-center gap-6 px-6 pt-8 pb-12 text-center ${embedded ? "h-full justify-center" : ""}`}
    >
      {logo}
      {titleBlock}
    </header>
  );
}

export function CompletaCover({
  headerRef,
  box,
  protect,
  noMenu,
  photo,
  shield,
  titleBlock,
  scroll,
}: CoverParts) {
  return (
    <header
      ref={headerRef}
      data-cover-layout="completa"
      className={`on-dark relative flex w-full flex-col justify-between overflow-hidden bg-night text-white ${box}${protect}`}
      onContextMenu={noMenu}
    >
      {photo}
      {shield}
      <div aria-hidden="true" className="cover-scrim absolute inset-0" />
      <div className="relative p-6">
        <Logo variant="light" className="h-12" />
      </div>
      <div className="relative flex flex-col items-center gap-6 px-6 pb-10 text-center">
        {titleBlock}
        <ScrollCue {...scroll} className="text-white/80 hover:text-white" />
      </div>
    </header>
  );
}

function ScrollCue({
  embedded,
  label,
  onScroll,
  className,
}: {
  embedded: boolean;
  label: string;
  onScroll?: () => void;
  className: string;
}) {
  const cls = `text-micro-label flex min-h-11 flex-col items-center gap-1 uppercase ${className}`;
  return embedded ? (
    <span aria-hidden="true" className={cls}>
      {label}
      <ChevronDown className="size-5" />
    </span>
  ) : (
    <button
      type="button"
      onClick={onScroll}
      className={`${cls} duration-base ease-out-soft transition-colors`}
    >
      {label}
      <ChevronDown className="size-5" aria-hidden="true" />
    </button>
  );
}
