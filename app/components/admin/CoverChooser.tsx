import { Form } from "react-router";

import { useT } from "../../i18n/use-t";
import { ChevronDown } from "../icons";
import { adminImgSrc, type Versions } from "../img-url";
import { btn } from "./gallery-edit/ui";
import type { ChooserPhoto } from "./CoverPreview";

type CoverChooserProps = {
  photos: readonly ChooserPhoto[];
  editing: "desktop" | "mobile";
  device: "desktop" | "mobile";
  coverAuto: boolean;
  hasMobileCover: boolean;
  pickId: string | null;
  versions?: Versions;
  busy: boolean;
};

/** "Use the first photo" / "use the desktop cover": back to the automatic choice. */
function ResetButtons({
  device,
  coverAuto,
  hasMobileCover,
  busy,
}: Pick<
  CoverChooserProps,
  "device" | "coverAuto" | "hasMobileCover" | "busy"
>) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2">
      {device === "desktop" && !coverAuto && (
        <Form method="post">
          <input type="hidden" name="intent" value="cover" />
          <input type="hidden" name="photoId" value="" />
          <button type="submit" className={btn} disabled={busy}>
            {t("admin.edit.photos.useFirst")}
          </button>
        </Form>
      )}
      {device === "mobile" && hasMobileCover && (
        <Form method="post">
          <input type="hidden" name="intent" value="cover" />
          <input type="hidden" name="device" value="mobile" />
          <input type="hidden" name="photoId" value="" />
          <button type="submit" className={btn} disabled={busy}>
            {t("admin.cover.useDesktop")}
          </button>
        </Form>
      )}
    </div>
  );
}

/** One thumbnail that posts "use this photo as the cover". */
function PickPhoto({
  photo,
  device,
  current,
  version,
  busy,
}: {
  photo: ChooserPhoto;
  device: "desktop" | "mobile";
  current: boolean;
  version: string | null | undefined;
  busy: boolean;
}) {
  const t = useT();
  return (
    <li className="list-none">
      <Form method="post">
        <input type="hidden" name="intent" value="cover" />
        {device === "mobile" && (
          <input type="hidden" name="device" value="mobile" />
        )}
        <input type="hidden" name="photoId" value={photo.id} />
        <button
          type="submit"
          disabled={busy}
          aria-label={t("admin.cover.useNamed", { name: photo.name })}
          aria-current={current ? "true" : undefined}
          className={`bg-grey-100 focus-visible:outline-ink block aspect-square w-full overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 ${current ? "outline-ink outline-2 outline-offset-1" : ""}`}
        >
          <img
            src={adminImgSrc(photo.id, "thumb", version)}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-full object-cover"
          />
        </button>
      </Form>
    </li>
  );
}

/** Step 1 footer: current cover name, reset buttons and the photo picker grid. */
export function CoverChooser(props: CoverChooserProps) {
  const { photos, editing, device, coverAuto, hasMobileCover, pickId } = props;
  const t = useT();
  const nameOf = (id: string | null) =>
    photos.find((p) => p.id === id)?.name ?? "";
  if (photos.length === 0) return null;
  return (
    <div className="border-grey-200 flex flex-col gap-3 border-t pt-4">
      <p className="text-small">
        {editing === "mobile"
          ? t("admin.cover.photoMobile", { name: nameOf(pickId) })
          : coverAuto
            ? t("admin.cover.photoAuto", { name: nameOf(pickId) })
            : t("admin.cover.photo", { name: nameOf(pickId) })}
      </p>
      <ResetButtons
        device={device}
        coverAuto={coverAuto}
        hasMobileCover={hasMobileCover}
        busy={props.busy}
      />
      <details
        className="group/choose"
        open={device === "mobile" && !hasMobileCover ? true : undefined}
      >
        <summary className="text-micro text-ink flex min-h-tap cursor-pointer list-none items-center gap-2 uppercase underline-offset-4 hover:underline md:min-h-8 [&::-webkit-details-marker]:hidden">
          {device === "mobile" && !hasMobileCover
            ? t("admin.cover.chooseMobile")
            : t("admin.cover.change")}
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-open/choose:rotate-180"
          />
        </summary>
        <ul className="mt-3 grid max-h-80 grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-6">
          {photos.map((p) => (
            <PickPhoto
              key={p.id}
              photo={p}
              device={device}
              current={p.id === pickId}
              version={props.versions?.[p.id]}
              busy={props.busy}
            />
          ))}
        </ul>
      </details>
    </div>
  );
}
