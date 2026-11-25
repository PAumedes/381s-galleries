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

/** "Use as (mobile) cover" button, or the current cover shown as a pressed one. */
function CoverAction({
  id,
  device,
  current,
  busy,
  Icon,
  label,
  currentName,
  useName,
}: {
  id: string;
  /** Posted as `device` for the mobile cover; the desktop cover omits it. */
  device?: "mobile";
  current: boolean;
  busy: boolean;
  Icon: typeof Monitor;
  label: string;
  currentName: string;
  useName: string;
}) {
  const icon = <Icon aria-hidden="true" className="size-4 shrink-0" />;
  const describedBy = `photo-${id}`;
  if (current)
    return (
      <Action
        icon={icon}
        label={label}
        name={currentName}
        title={currentName}
        describedBy={describedBy}
        pressed
      />
    );
  return (
    <Form method="post" className="contents">
      <input type="hidden" name="intent" value="cover" />
      {device && <input type="hidden" name="device" value={device} />}
      <input type="hidden" name="photoId" value={id} />
      <Action
        type="submit"
        icon={icon}
        label={label}
        name={useName}
        title={useName}
        describedBy={describedBy}
        disabled={busy}
      />
    </Form>
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
  return (
    <div data-tile-actions="" className={BAR}>
      <CoverAction
        id={id}
        current={isCover && !coverAuto}
        busy={busy}
        Icon={Monitor}
        label={t("admin.reorder.tileCover")}
        currentName={t("admin.reorder.isCover")}
        useName={t("admin.reorder.useAsCover")}
      />
      <CoverAction
        id={id}
        device="mobile"
        current={isMobile}
        busy={busy}
        Icon={Phone}
        label={t("admin.reorder.tileMobile")}
        currentName={t("admin.reorder.isMobileCover")}
        useName={t("admin.reorder.useAsMobileCover")}
      />
      <Action
        type="button"
        icon={<Expand aria-hidden="true" className="size-4 shrink-0" />}
        label={t("admin.reorder.tileView")}
        name={t("admin.reorder.viewFull")}
        title={t("admin.reorder.viewFull")}
        describedBy={`photo-${id}`}
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
