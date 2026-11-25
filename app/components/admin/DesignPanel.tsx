import { useId } from "react";

import { useT } from "../../i18n/use-t";
import type { MessageKey } from "../../i18n/t";

import { CoverThumb, GapThumb, GridThumb, PaletteThumb } from "./design-thumbs";
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

type Group = (typeof GROUPS)[number];

/** One question of the panel: its title, the option cards (radio inputs) and the field error. */
function DesignGroup({
  group,
  uid,
  design,
  error,
  onChange,
}: {
  group: Group;
  uid: string;
  design: Design;
  error: string | undefined;
  onChange: (next: Design) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <p id={`${uid}-${group.name}`} className="text-small">
        {t(group.title)}
      </p>
      <div
        role="radiogroup"
        aria-label={t(group.title)}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {group.options.map((o) => {
          const checked = design[group.name] === o.value;
          return (
            <label
              key={o.value}
              className={`has-[:focus-visible]:outline-ink flex cursor-pointer flex-col gap-1 border p-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
                checked ? "border-ink border-2" : "border-grey-300"
              }`}
            >
              <input
                type="radio"
                name={group.name}
                value={o.value}
                checked={checked}
                onChange={() =>
                  onChange({ ...design, [group.name]: o.value } as Design)
                }
                className="sr-only"
              />
              {group.thumb(o.value)}
              <span className="text-micro uppercase">{t(o.label)}</span>
            </label>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-small text-ink font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

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
  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map((group) => (
        <DesignGroup
          key={group.name}
          group={group}
          uid={uid}
          design={design}
          error={errors[group.errKey]}
          onChange={onChange}
        />
      ))}
    </div>
  );
}
