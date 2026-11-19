import { useId, useMemo, useState } from "react";
import { useNavigation, useSearchParams } from "react-router";

import { useT } from "../../i18n/use-t";
import type { Design } from "../../lib/design";
import type { GalleryActionResult } from "../../lib/server/admin-galleries";
import { versionsOf } from "../img-url";
import { CoverTab } from "./gallery-edit/CoverTab";
import { DangerSection } from "./gallery-edit/DangerSection";
import { resolveEditorCover } from "./gallery-edit/cover";
import { DesignBar, DesignSection } from "./gallery-edit/DesignSection";
import { DetailsSection } from "./gallery-edit/DetailsSection";
import { EditorColumns } from "./gallery-edit/EditorColumns";
import { EditorHeader } from "./gallery-edit/EditorHeader";
import { EditorPreview } from "./gallery-edit/EditorPreview";
import { HomeSection } from "./gallery-edit/HomeSection";
import { OptionsSection } from "./gallery-edit/OptionsSection";
import { PhotosTab } from "./gallery-edit/PhotosTab";
import { PinSection } from "./gallery-edit/PinSection";
import { ShareSections } from "./gallery-edit/ShareSections";
import { StatusSection } from "./gallery-edit/StatusSection";
import type { FieldErrors, GalleryEditData } from "./gallery-edit/types";
import { useCoverPrefetch } from "./gallery-edit/useCoverPrefetch";
import { useDesignDraft } from "./gallery-edit/useDesignDraft";
import { GalleryTabs, isEditorTab, type EditorTab } from "./GalleryTabs";
import { type PreviewDevice } from "./LivePreview";
import { usePendingCover, withPendingCover } from "./optimistic-cover";

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

/** Field errors of the last action when it was this intent's and failed. */
function fieldErrorsOf(
  actionData: GalleryActionResult | undefined,
  intent: string,
): FieldErrors {
  return actionData && actionData.intent === intent && !actionData.ok
    ? (actionData.fieldErrors ?? {})
    : {};
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
  const [mode, setMode] = useState<"proofing" | "delivery">(g.mode);
  const proofing = mode === "proofing";
  useCoverPrefetch(pendingCover, { proofing, versions });
  const [title, setTitle] = useState(g.title);
  const [eventDate, setEventDate] = useState(g.eventDate ?? "");
  const saved: Design = {
    palette: g.palette,
    coverLayout: g.coverLayout,
    gridStyle: g.gridStyle,
    gridGap: g.gridGap,
  };
  const draft = useDesignDraft(saved);
  const { design, dirty: designDirty } = draft;
  // One device for every preview of the editor (switching tabs keeps it).
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const designFormId = useId();
  const cover = resolveEditorCover(g, data.photos);
  const previewState = {
    title,
    eventDate,
    design,
    proofing,
    versions,
    device,
    onDevice: setDevice,
  };
  const preview = (hint: string, footer?: React.ReactNode) => (
    <EditorPreview
      g={g}
      photos={data.photos}
      cover={cover}
      state={previewState}
      heading={t("admin.preview.heading")}
      hint={hint}
      footer={footer}
    />
  );

  return (
    <div
      className={`flex flex-col gap-6 ${designDirty && tab === "diseno" ? "max-lg:pb-24" : ""}`}
    >
      <EditorHeader g={g} />
      <GalleryTabs
        id={g.id}
        current={tab}
        unsaved={designDirty ? ["diseno"] : []}
      />

      {tab === "datos" && (
        <EditorColumns
          main={
            <>
              <DetailsSection
                g={g}
                errors={fieldErrorsOf(actionData, "details")}
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
                errors={fieldErrorsOf(actionData, "pin")}
                busy={busy}
                actionData={actionData}
              />
              <HomeSection g={g} busy={busy} actionData={actionData} />
              <OptionsSection
                g={g}
                data={data}
                proofing={proofing}
                onMode={setMode}
                errors={fieldErrorsOf(actionData, "flags")}
                busy={busy}
                actionData={actionData}
              />
              <DangerSection
                slug={g.slug}
                deleting={data.deleting}
                busy={busy}
                actionData={actionData}
              />
            </>
          }
          preview={preview(t("admin.preview.hint"))}
        />
      )}

      {tab === "fotos" && (
        <PhotosTab
          data={data}
          g={g}
          coverId={cover.coverId}
          actionData={actionData}
        />
      )}

      {tab === "portada" && (
        <CoverTab
          g={g}
          photos={data.photos}
          cover={cover}
          state={previewState}
          actionData={actionData}
        />
      )}

      {tab === "diseno" && (
        <EditorColumns
          previewFirst
          main={
            <DesignSection
              formId={designFormId}
              design={design}
              onChange={draft.setDesign}
              errors={fieldErrorsOf(actionData, "design")}
              actionData={actionData}
            />
          }
          preview={preview(
            t("admin.preview.designHint"),
            <DesignBar
              formId={designFormId}
              dirty={designDirty}
              busy={busy}
              onDiscard={draft.discard}
            />,
          )}
        />
      )}

      {tab === "compartir" && (
        <EditorColumns
          main={<ShareSections g={g} origin={origin} />}
          preview={preview(t("admin.preview.hint"))}
        />
      )}
    </div>
  );
}
