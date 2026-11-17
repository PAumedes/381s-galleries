import { useId } from "react";

import { useT } from "../../i18n/use-t";
import type { MessageKey } from "../../i18n/t";

import {
  COVER_LAYOUTS,
  GRID_GAPS,
  GRID_STYLES,
  PALETTES,
  type CoverLayout,
  type Design,
  type GridGap,
  type GridStyle,
  type Palette,
} from "../../lib/design";

/** Schematic thumbnails are CSS/SVG only (no images). */
const FRAME = "h-14 w-full border border-grey-300";
const ph = "fill-grey-400";

function PaletteThumb({ value }: { value: Palette }) {
  return (
    <span
      data-thumb=""
      data-theme={value}
      aria-hidden="true"
      className={`${FRAME} bg-paper flex flex-col justify-center gap-1.5 px-3`}
    >
      <span className="bg-ink h-1.5 w-2/3" />
      <span className="bg-grey-600 h-1 w-full" />
      <span className="bg-grey-300 h-1 w-1/2" />
    </span>
  );
}

function CoverThumb({ value }: { value: CoverLayout }) {
  return (
    <span data-thumb="" aria-hidden="true" className={`${FRAME} bg-white`}>
      <svg viewBox="0 0 80 52" className="size-full">
        {value === "completa" && (
          <>
            <rect width="80" height="52" className="fill-grey-700" />
            <rect x="24" y="30" width="32" height="3" className="fill-white" />
            <rect
              x="30"
              y="36"
              width="20"
              height="2"
              className="fill-white/70"
            />
          </>
        )}
        {value === "dividida" && (
          <>
            <rect width="48" height="52" className="fill-grey-700" />
            <rect
              x="54"
              y="20"
              width="20"
              height="3"
              className="fill-grey-900"
            />
            <rect
              x="56"
              y="27"
              width="16"
              height="2"
              className="fill-grey-500"
            />
          </>
        )}
        {value === "centrada" && (
          <>
            <rect
              x="10"
              y="5"
              width="60"
              height="30"
              className="fill-grey-700"
            />
            <rect
              x="26"
              y="40"
              width="28"
              height="3"
              className="fill-grey-900"
            />
            <rect
              x="32"
              y="46"
              width="16"
              height="2"
              className="fill-grey-500"
            />
          </>
        )}
        {value === "minima" && (
          <>
            <rect
              x="22"
              y="14"
              width="36"
              height="3"
              className="fill-grey-900"
            />
            <rect
              x="30"
              y="21"
              width="20"
              height="2"
              className="fill-grey-500"
            />
            <rect x="4" y="32" width="22" height="16" className={ph} />
            <rect x="29" y="32" width="22" height="16" className={ph} />
            <rect x="54" y="32" width="22" height="16" className={ph} />
          </>
        )}
      </svg>
    </span>
  );
}

function GridThumb({ value }: { value: GridStyle }) {
  return (
    <span data-thumb="" aria-hidden="true" className={`${FRAME} bg-white`}>
      <svg viewBox="0 0 80 52" className="size-full">
        {value === "filas" && (
          <>
            <rect x="4" y="4" width="30" height="20" className={ph} />
            <rect x="36" y="4" width="18" height="20" className={ph} />
            <rect x="56" y="4" width="20" height="20" className={ph} />
            <rect x="4" y="27" width="20" height="21" className={ph} />
            <rect x="26" y="27" width="28" height="21" className={ph} />
            <rect x="56" y="27" width="20" height="21" className={ph} />
          </>
        )}
        {value === "cuadricula" &&
          [0, 1].flatMap((r) =>
            [0, 1, 2, 3].map((c) => (
              <rect
                key={`${r}${c}`}
                x={4 + c * 19}
                y={5 + r * 23}
                width="17"
                height="20"
                className={ph}
              />
            )),
          )}
        {value === "columnas" && (
          <>
            <rect x="4" y="4" width="22" height="26" className={ph} />
            <rect x="4" y="33" width="22" height="15" className={ph} />
            <rect x="29" y="4" width="22" height="14" className={ph} />
            <rect x="29" y="21" width="22" height="27" className={ph} />
            <rect x="54" y="4" width="22" height="20" className={ph} />
            <rect x="54" y="27" width="22" height="21" className={ph} />
          </>
        )}
      </svg>
    </span>
  );
}

function GapThumb({ value }: { value: GridGap }) {
  const g = value === "compacto" ? 1 : value === "normal" ? 3 : 7;
  const size = (60 - 2 * g) / 3;
  return (
    <span data-thumb="" aria-hidden="true" className={`${FRAME} bg-white`}>
      <svg viewBox="0 0 80 52" className="size-full">
        {[0, 1].flatMap((r) =>
          [0, 1, 2].map((c) => (
            <rect
              key={`${r}${c}`}
              x={10 + c * (size + g)}
              y={(52 - (2 * 20 + g)) / 2 + r * (20 + g)}
              width={size}
              height="20"
              className={ph}
            />
          )),
        )}
      </svg>
    </span>
  );
}

const PALETTE_KEYS: Record<Palette, MessageKey> = {
  claro: "admin.design.palette.claro",
  oscuro: "admin.design.palette.oscuro",
  arena: "admin.design.palette.arena",
  gris: "admin.design.palette.gris",
};
/** Message key of a palette name (also used by the cover preview). */
export const paletteKey = (p: Palette): MessageKey => PALETTE_KEYS[p];
const COVER_KEYS: Record<CoverLayout, MessageKey> = {
  completa: "admin.design.cover.completa",
  dividida: "admin.design.cover.dividida",
  centrada: "admin.design.cover.centrada",
  minima: "admin.design.cover.minima",
};
const GRID_KEYS: Record<GridStyle, MessageKey> = {
  filas: "admin.design.grid.filas",
  cuadricula: "admin.design.grid.cuadricula",
  columnas: "admin.design.grid.columnas",
};
const GAP_KEYS: Record<GridGap, MessageKey> = {
  compacto: "admin.design.gap.compacto",
  normal: "admin.design.gap.normal",
  amplio: "admin.design.gap.amplio",
};

type Option = { value: string; label: MessageKey };

const GROUPS: {
  name: keyof Design;
  title: MessageKey;
  options: Option[];
  thumb: (v: string) => React.ReactNode;
  errKey: keyof Design;
}[] = [
  {
    name: "palette",
    title: "admin.design.palette",
    errKey: "palette",
    options: PALETTES.map((v) => ({ value: v, label: PALETTE_KEYS[v] })),
    thumb: (v) => <PaletteThumb value={v as Palette} />,
  },
  {
    name: "coverLayout",
    title: "admin.design.coverLayout",
    errKey: "coverLayout",
    options: COVER_LAYOUTS.map((v) => ({ value: v, label: COVER_KEYS[v] })),
    thumb: (v) => <CoverThumb value={v as CoverLayout} />,
  },
  {
    name: "gridStyle",
    title: "admin.design.gridStyle",
    errKey: "gridStyle",
    options: GRID_STYLES.map((v) => ({ value: v, label: GRID_KEYS[v] })),
    thumb: (v) => <GridThumb value={v as GridStyle} />,
  },
  {
    name: "gridGap",
    title: "admin.design.gridGap",
    errKey: "gridGap",
    options: GRID_GAPS.map((v) => ({ value: v, label: GAP_KEYS[v] })),
    thumb: (v) => <GapThumb value={v as GridGap} />,
  },
];

/**
 * "Diseño": visual option cards (radio inputs) for palette, cover layout, grid
 * style and spacing. Controlled, so the parent can feed the live cover preview.
 * Typography is fixed (Montserrat): no font option.
 */
export function DesignPanel({
  design,
  onChange,
  errors,
}: {
  design: Design;
  onChange: (next: Design) => void;
  errors: Record<string, string>;
}) {
  const uid = useId();
  const t = useT();
  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map((grp) => {
        const err = errors[grp.errKey];
        return (
          <div key={grp.name} className="flex flex-col gap-2">
            <p id={`${uid}-${grp.name}`} className="text-small">
              {t(grp.title)}
            </p>
            <div
              role="radiogroup"
              aria-label={t(grp.title)}
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            >
              {grp.options.map((o) => {
                const checked = design[grp.name] === o.value;
                return (
                  <label
                    key={o.value}
                    className={`has-[:focus-visible]:outline-ink flex cursor-pointer flex-col gap-1 border p-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
                      checked ? "border-ink border-2" : "border-grey-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name={grp.name}
                      value={o.value}
                      checked={checked}
                      onChange={() =>
                        onChange({ ...design, [grp.name]: o.value } as Design)
                      }
                      className="sr-only"
                    />
                    {grp.thumb(o.value)}
                    <span className="text-micro uppercase">{t(o.label)}</span>
                  </label>
                );
              })}
            </div>
            {err && (
              <p role="alert" className="text-small text-ink font-medium">
                {err}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
