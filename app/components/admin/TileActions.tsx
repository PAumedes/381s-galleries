import { Form } from "react-router";

import { useT } from "../../i18n/use-t";
import { Expand, Monitor, Phone } from "../icons";

/** Narrow tiles (under ~3 x 44px + gaps, 140px; 10.5rem leaves margin) stack the buttons as full-width rows. */
const BAR = "grid grid-cols-3 gap-1 @max-[10.5rem]:grid-cols-1";
const ACTION =
  "text-micro tracking-normal border-grey-300 text-grey-700 hover:border-ink hover:text-ink flex min-h-tap min-w-0 flex-col items-center justify-center gap-0.5 border px-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink aria-disabled:cursor-default aria-pressed:bg-ink aria-pressed:border-ink aria-pressed:text-paper disabled:opacity-50 @max-[10.5rem]:flex-row @max-[10.5rem]:gap-2";

function Action({
  icon,
  label,
  name,
  title,
  pressed,
  describedBy,
  ...rest
}: {
  icon: React.ReactNode;
  label: string;
  name: string;
  title: string;
  /** Current state: aria-pressed + aria-disabled (stays focusable, never posts). */
  pressed?: true;
  describedBy: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={name}
      aria-describedby={describedBy}
      aria-pressed={pressed}
      aria-disabled={pressed ? true : undefined}
      onClick={pressed ? (e) => e.preventDefault() : undefined}
      title={title}
      className={ACTION}
      type="button"
      {...rest}
    >
      {icon}
      <span className="max-w-full truncate text-[0.6875rem] uppercase @max-[13rem]:tracking-tighter @max-[13rem]:text-[0.625rem]">
        {label}
      </span>
    </button>
  );
}

/**
 * Per-tile actions under the picture (nothing on top of it): use as cover,
 * use as mobile cover, view whole. Icon + short label; the accessible name is
 * the long text. The current cover shows as a pressed, aria-disabled (still focusable) button.
 */
export function TileActions({
  id,
  isCover,
  coverAuto,
  isMobile,
  busy,
  onView,
}: {
  id: string;
  isCover: boolean;
  /** Automatic cover: it can still be pinned. */
  coverAuto: boolean;
  isMobile: boolean;
  busy: boolean;
  onView: () => void;
}) {
  const t = useT();
  const desc = `photo-${id}`;
  const icon = (I: typeof Monitor) => (
    <I aria-hidden="true" className="size-4 shrink-0" />
  );
  const pinned = isCover && !coverAuto;
  return (
    <div data-tile-actions="" className={BAR}>
      {pinned ? (
        <Action
          icon={icon(Monitor)}
          label={t("admin.reorder.tileCover")}
          name={t("admin.reorder.isCover")}
          title={t("admin.reorder.isCover")}
          describedBy={desc}
          pressed
        />
      ) : (
        <Form method="post" className="contents">
          <input type="hidden" name="intent" value="cover" />
          <input type="hidden" name="photoId" value={id} />
          <Action
            type="submit"
            icon={icon(Monitor)}
            label={t("admin.reorder.tileCover")}
            name={t("admin.reorder.useAsCover")}
            title={t("admin.reorder.useAsCover")}
            describedBy={desc}
            disabled={busy}
          />
        </Form>
      )}
      {isMobile ? (
        <Action
          icon={icon(Phone)}
          label={t("admin.reorder.tileMobile")}
          name={t("admin.reorder.isMobileCover")}
          title={t("admin.reorder.isMobileCover")}
          describedBy={desc}
          pressed
        />
      ) : (
        <Form method="post" className="contents">
          <input type="hidden" name="intent" value="cover" />
          <input type="hidden" name="device" value="mobile" />
          <input type="hidden" name="photoId" value={id} />
          <Action
            type="submit"
            icon={icon(Phone)}
            label={t("admin.reorder.tileMobile")}
            name={t("admin.reorder.useAsMobileCover")}
            title={t("admin.reorder.useAsMobileCover")}
            describedBy={desc}
            disabled={busy}
          />
        </Form>
      )}
      <Action
        type="button"
        icon={icon(Expand)}
        label={t("admin.reorder.tileView")}
        name={t("admin.reorder.viewFull")}
        title={t("admin.reorder.viewFull")}
        describedBy={desc}
        onClick={onView}
      />
    </div>
  );
}

/** "Portada" / "Móvil" badges in the picture's top-right corner. */
export function TileBadges({
  isCover,
  isMobile,
  coverLabel,
}: {
  isCover: boolean;
  isMobile: boolean;
  /** "Portada" or "Portada automática (primera foto)" (the badge title). */
  coverLabel: string;
}) {
  const t = useT();
  if (!isCover && !isMobile) return null;
  return (
    <span className="pointer-events-none absolute top-0 right-0 flex max-w-[calc(100%-1.5rem)]">
      {isCover && (
        <span
          data-cover-badge="desktop"
          title={coverLabel}
          className="bg-ink text-paper text-micro flex min-w-0 items-center gap-1 px-1.5 py-0.5 uppercase"
        >
          <Monitor aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{t("admin.reorder.cover")}</span>
        </span>
      )}
      {isMobile && (
        <span
          data-cover-badge="mobile"
          title={t("admin.reorder.coverMobile")}
          className="bg-ink text-paper text-micro border-paper/40 flex min-w-0 items-center gap-1 border-l px-1.5 py-0.5 uppercase"
        >
          <Phone aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{t("admin.reorder.tileMobile")}</span>
        </span>
      )}
    </span>
  );
}
