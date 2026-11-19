import { useEffect, useId, useMemo, useState } from "react";
import {
  Form,
  Link,
  useBlocker,
  useNavigation,
  useSearchParams,
} from "react-router";

import { useT } from "../../i18n/use-t";
import { ISSUE_KEYS } from "../../lib/admin-gallery";
import type { GalleryActionResult } from "../../lib/server/admin-galleries";
import { btn, btnPrimary, Feedback, Section } from "./gallery-edit/ui";
import type { GalleryEditData } from "./gallery-edit/types";
import { DetailsSection } from "./gallery-edit/DetailsSection";
import { StatusSection } from "./gallery-edit/StatusSection";
import { PinSection } from "./gallery-edit/PinSection";
import { HomeSection } from "./gallery-edit/HomeSection";
import { OptionsSection } from "./gallery-edit/OptionsSection";
import { DangerSection } from "./gallery-edit/DangerSection";
import type { Design } from "../../lib/design";
import { External } from "../icons";
import { versionsOf } from "../img-url";
import { CoverPreview } from "./CoverPreview";
import { DesignPanel } from "./DesignPanel";
import { GalleryTabs, isEditorTab, type EditorTab } from "./GalleryTabs";
import { StatusPill } from "./GalleryList";
import { coverSrc, LivePreview, type PreviewDevice } from "./LivePreview";
import { usePendingCover, withPendingCover } from "./optimistic-cover";
import { PhotoReorder } from "./PhotoReorder";
import { SharePanel } from "./SharePanel";

export type { GalleryEditData };

/**
 * Keyed by gallery id: the local copies of title / mode / design / device
 * must not survive a navigation between two galleries.
 */
export function GalleryEditView(props: {
  data: GalleryEditData;
  origin?: string;
  actionData: GalleryActionResult | undefined;
}) {
  return <GalleryEditViewInner key={props.data.gallery.id} {...props} />;
}

function GalleryEditViewInner({
  data,
  origin,
  actionData,
}: {
  data: GalleryEditData;
  origin?: string;
  actionData: GalleryActionResult | undefined;
}) {
  const t = useT();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [params] = useSearchParams();
  const rawTab = params.get("tab");
  const tab: EditorTab = isEditorTab(rawTab) ? rawTab : "datos";
  // A cover choice shows at once (the server confirms, or it rolls back).
  const photoIds = useMemo(
    () => new Set(data.photos.map((p) => p.id)),
    [data.photos],
  );
  const noWmIds = useMemo(
    () =>
      new Set(
        data.gallery.mode === "proofing"
          ? data.photos.filter((p) => p.hasWm === false).map((p) => p.id)
          : [],
      ),
    [data.photos, data.gallery.mode],
  );
  const pendingCover = usePendingCover(photoIds, actionData, noWmIds);
  const g = withPendingCover(data.gallery, pendingCover);
  const versions = useMemo(() => versionsOf(data.photos), [data.photos]);
  const errs = (intent: string) =>
    actionData && actionData.intent === intent && !actionData.ok
      ? (actionData.fieldErrors ?? {})
      : {};
  const de = errs("details");
  const pe = errs("pin");
  const fe = errs("flags");
  const ge = errs("design");
  const [mode, setMode] = useState<"proofing" | "delivery">(g.mode);
  const proofing = mode === "proofing";
  useEffect(() => {
    if (!pendingCover?.photoId) return;
    // Start fetching what the previews and the picker will ask for.
    const v = versions[pendingCover.photoId];
    for (const src of [
      coverSrc(pendingCover.photoId, proofing, v),
      coverSrc(pendingCover.photoId, false, v),
    ])
      new Image().src = src;
  }, [pendingCover?.photoId, proofing, versions]);
  const [title, setTitle] = useState(g.title);
  const [eventDate, setEventDate] = useState(g.eventDate ?? "");
  const saved: Design = {
    palette: g.palette,
    coverLayout: g.coverLayout,
    gridStyle: g.gridStyle,
    gridGap: g.gridGap,
  };
  const [design, setDesign] = useState<Design>(saved);
  // A saved design coming back from the server becomes the new baseline.
  const savedKey = JSON.stringify(saved);
  const [seenSaved, setSeenSaved] = useState(savedKey);
  if (seenSaved !== savedKey) {
    setSeenSaved(savedKey);
    setDesign(saved);
  }
  const designDirty = JSON.stringify(design) !== savedKey;
  // Leaving the editor (another page, the list, reload) with unsaved design
  // changes asks first. Tabs and the save submit stay on the same pathname.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      designDirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const leaveMsg = t("admin.design.leaveConfirm");
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(leaveMsg)) blocker.proceed();
    else blocker.reset();
  }, [blocker, leaveMsg]);
  useEffect(() => {
    if (!designDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [designDirty]);
  // One device for every preview of the editor (switching tabs keeps it).
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const coverId = g.coverPhotoId ?? data.photos[0]?.id ?? null;
  const coverPhoto = data.photos.find((p) => p.id === coverId);
  const mobilePhoto = g.coverPhotoIdMobile
    ? data.photos.find((p) => p.id === g.coverPhotoIdMobile)
    : undefined;
  const aspect = (p?: { width?: number | null; height?: number | null }) =>
    p?.width && p.height ? p.width / p.height : null;
  const designFormId = useId();

  const preview = (opts: {
    heading: string;
    hint: string;
    footer?: React.ReactNode;
  }) => (
    <LivePreview
      heading={opts.heading}
      hint={opts.hint}
      title={title}
      eventDate={eventDate || null}
      palette={design.palette}
      coverLayout={design.coverLayout}
      gridStyle={design.gridStyle}
      gridGap={design.gridGap}
      proofing={proofing}
      cover={
        coverId
          ? { id: coverId, aspect: aspect(coverPhoto), focus: g.coverFocus }
          : null
      }
      mobileCover={
        mobilePhoto
          ? {
              id: mobilePhoto.id,
              aspect: aspect(mobilePhoto),
              focus: g.coverFocusMobile ?? null,
            }
          : null
      }
      photos={data.photos}
      versions={versions}
      device={device}
      onDevice={setDevice}
    >
      {opts.footer}
    </LivePreview>
  );

  const twoColumns = (
    left: React.ReactNode,
    right: React.ReactNode,
    previewFirst = false,
  ) => (
    <div
      data-editor-grid=""
      className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10 2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
    >
      <div className="flex min-w-0 flex-col gap-8">{left}</div>
      <aside
        data-preview-column=""
        className={`min-w-0 lg:sticky lg:top-6 ${previewFirst ? "order-first lg:order-none" : ""}`}
      >
        {right}
      </aside>
    </div>
  );

  const designBar = (
    <div
      className={`bg-paper border-grey-200 flex flex-wrap items-center gap-2 border-t pt-3 ${designDirty ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:px-4 max-lg:pb-3" : ""}`}
    >
      <p role="status" className="text-small mr-auto flex items-center gap-2">
        {designDirty ? (
          <>
            <span
              aria-hidden="true"
              className="bg-ink inline-block size-2 rounded-full"
            />
            <span>{t("admin.design.unsaved")}</span>
          </>
        ) : (
          <span className="text-grey-600">{t("admin.design.saved")}</span>
        )}
      </p>
      <button
        type="button"
        className={btn}
        disabled={!designDirty}
        onClick={() => setDesign(JSON.parse(savedKey) as Design)}
      >
        {t("admin.design.discard")}
      </button>
      <button
        type="submit"
        form={designFormId}
        className={btnPrimary}
        disabled={busy || !designDirty}
      >
        {t("admin.edit.saveDesign")}
      </button>
    </div>
  );

  return (
    <div
      className={`flex flex-col gap-6 ${designDirty && tab === "diseno" ? "max-lg:pb-24" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          to="/admin"
          className="text-micro text-grey-700 hover:text-ink flex min-h-tap items-center uppercase md:min-h-0"
        >
          {t("admin.backToGalleries")}
        </Link>
        <h1 className="text-title text-ink min-w-0 break-words">{g.title}</h1>
        <StatusPill status={g.status} />
        <a
          href={`/admin/g/${encodeURIComponent(g.id)}/preview`}
          target="_blank"
          rel="noopener noreferrer"
          title={t("admin.edit.previewHint")}
          className={`${btn} ml-auto flex items-center gap-2`}
        >
          <External aria-hidden="true" className="size-4" />
          {t("admin.edit.preview")}
        </a>
      </div>
      <GalleryTabs
        id={g.id}
        current={tab}
        unsaved={designDirty ? ["diseno"] : []}
      />

      {tab === "datos" &&
        twoColumns(
          <>
            <DetailsSection
              g={g}
              errors={de}
              title={title}
              onTitle={setTitle}
              eventDate={eventDate}
              onEventDate={setEventDate}
              busy={busy}
              actionData={actionData}
            />
            <StatusSection
              status={g.status}
              busy={busy}
              actionData={actionData}
            />

            <PinSection
              hasPin={g.hasPin}
              errors={pe}
              busy={busy}
              actionData={actionData}
            />

            <HomeSection g={g} busy={busy} actionData={actionData} />

            <OptionsSection
              g={g}
              data={data}
              proofing={proofing}
              onMode={setMode}
              errors={fe}
              busy={busy}
              actionData={actionData}
            />

            <DangerSection
              slug={g.slug}
              deleting={data.deleting}
              busy={busy}
              actionData={actionData}
            />
          </>,
          preview({
            heading: t("admin.preview.heading"),
            hint: t("admin.preview.hint"),
          }),
        )}

      {tab === "fotos" && (
        <div className="flex flex-col gap-10">
          <Section title={t("admin.edit.section.photos")}>
            {data.photos.length === 0 ? (
              <p className="text-small text-grey-600">
                {t("admin.edit.photos.empty")}
              </p>
            ) : (
              <>
                <PhotoReorder
                  key={data.photos.map((p) => p.id).join(",")}
                  photos={data.photos}
                  version={data.version}
                  coverPhotoId={coverId}
                  coverAuto={g.coverPhotoId === null}
                  mobileCoverId={g.coverPhotoIdMobile ?? null}
                  actionData={actionData}
                />
                <Feedback data={actionData} intent="cover" />
              </>
            )}
          </Section>
          <Section title={t("admin.edit.section.issues")}>
            {data.issues.total === 0 ? (
              <p className="text-small text-grey-600">
                {t("admin.edit.issues.none")}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {data.issues.groups.map((grp) => (
                  <div key={grp.type}>
                    <h3 className="text-small font-medium">
                      {Object.hasOwn(ISSUE_KEYS, grp.type)
                        ? t(ISSUE_KEYS[grp.type]!)
                        : t("admin.issue.other")}{" "}
                      ({grp.items.length})
                    </h3>
                    <ul className="text-small text-grey-700 mt-1 list-disc pl-5">
                      {grp.items.map((it, i) => (
                        <li key={i}>
                          {it.set ? `${it.set} / ` : ""}
                          {it.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {data.issues.truncated > 0 && (
                  <p className="text-small text-grey-600">
                    {t("admin.edit.issues.more", {
                      count: data.issues.truncated,
                    })}
                  </p>
                )}
              </div>
            )}
          </Section>
        </div>
      )}

      {tab === "portada" && (
        <CoverPreview
          title={title}
          eventDate={eventDate || null}
          palette={design.palette}
          coverLayout={design.coverLayout}
          proofing={proofing}
          coverId={coverId}
          coverWidth={coverPhoto?.width ?? null}
          coverHeight={coverPhoto?.height ?? null}
          initialFocus={g.coverFocus}
          mobileCover={
            mobilePhoto
              ? {
                  id: mobilePhoto.id,
                  width: mobilePhoto.width ?? null,
                  height: mobilePhoto.height ?? null,
                  focus: g.coverFocusMobile ?? null,
                }
              : null
          }
          mobileNoWm={"mobileCoverNoWm" in g && g.mobileCoverNoWm === true}
          photos={data.photos}
          coverAuto={g.coverPhotoId === null}
          versions={versions}
          device={device}
          onDevice={setDevice}
          actionData={actionData}
        />
      )}

      {tab === "diseno" &&
        twoColumns(
          <Section title={t("admin.edit.section.design")}>
            <Form
              id={designFormId}
              data-design-form=""
              method="post"
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="intent" value="design" />
              <DesignPanel design={design} onChange={setDesign} errors={ge} />
              <p className="text-small text-grey-600">
                {t("admin.edit.designNote")}
              </p>
              <Feedback data={actionData} intent="design" />
            </Form>
          </Section>,
          preview({
            heading: t("admin.preview.heading"),
            hint: t("admin.preview.designHint"),
            footer: designBar,
          }),
          true,
        )}

      {tab === "compartir" &&
        twoColumns(
          <>
            <Section title={t("admin.edit.section.share")}>
              <SharePanel
                url={`${origin ?? window.location.origin}/${g.slug}`}
                slug={g.slug}
                title={g.title}
                status={g.status}
                hasPin={g.hasPin}
                cardHref={`/admin/g/${g.id}/card`}
              />
            </Section>

            <Section title={t("admin.edit.section.clientView")}>
              <p className="text-small text-grey-700">
                {t("admin.edit.clientViewNote")}
              </p>
              <div>
                <a
                  href={`/admin/g/${encodeURIComponent(g.id)}/preview`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${btn} inline-flex items-center gap-2`}
                >
                  <External aria-hidden="true" className="size-4" />
                  {t("admin.edit.openPreview")}
                </a>
              </div>
            </Section>
          </>,
          preview({
            heading: t("admin.preview.heading"),
            hint: t("admin.preview.hint"),
          }),
        )}
    </div>
  );
}
