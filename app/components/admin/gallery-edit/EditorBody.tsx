import type { ReactNode } from "react";

import { useT } from "../../../i18n/use-t";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import { CoverTab } from "./CoverTab";
import { DatosSections } from "./DatosSections";
import { DesignBar, DesignSection } from "./DesignSection";
import { EditorColumns } from "./EditorColumns";
import { EditorPreview } from "./EditorPreview";
import { fieldErrorsOf } from "./field-errors";
import { PhotosTab } from "./PhotosTab";
import { ShareSections } from "./ShareSections";
import type { GalleryEditData } from "./types";
import type { useGalleryEditorState } from "./useEditorState";

type EditorState = ReturnType<typeof useGalleryEditorState>;
type TabProps = {
  st: EditorState;
  data: GalleryEditData;
  actionData: GalleryActionResult | undefined;
};

/** The live preview column shared by the tabs that have one. */
function Preview({
  st,
  data,
  hint,
  footer,
}: {
  st: EditorState;
  data: GalleryEditData;
  hint: string;
  footer?: ReactNode;
}) {
  const t = useT();
  return (
    <EditorPreview
      g={st.g}
      photos={data.photos}
      cover={st.cover}
      state={st.previewState}
      heading={t("admin.preview.heading")}
      hint={hint}
      footer={footer}
    />
  );
}

function DatosTab({ st, data, actionData }: TabProps) {
  const t = useT();
  return (
    <EditorColumns
      main={
        <DatosSections
          g={st.g}
          data={data}
          proofing={st.proofing}
          onMode={st.setMode}
          title={st.title}
          onTitle={st.setTitle}
          eventDate={st.eventDate}
          onEventDate={st.setEventDate}
          busy={st.busy}
          actionData={actionData}
        />
      }
      preview={<Preview st={st} data={data} hint={t("admin.preview.hint")} />}
    />
  );
}

function DesignTab({ st, data, actionData }: TabProps) {
  const t = useT();
  const { draft } = st;
  return (
    <EditorColumns
      previewFirst
      main={
        <DesignSection
          formId={st.designFormId}
          design={draft.design}
          onChange={draft.setDesign}
          errors={fieldErrorsOf(actionData, "design")}
          actionData={actionData}
        />
      }
      preview={
        <Preview
          st={st}
          data={data}
          hint={t("admin.preview.designHint")}
          footer={
            <DesignBar
              formId={st.designFormId}
              dirty={draft.dirty}
              busy={st.busy}
              onDiscard={draft.discard}
            />
          }
        />
      }
    />
  );
}

function ShareTab({
  st,
  data,
  origin,
}: Omit<TabProps, "actionData"> & { origin?: string }) {
  const t = useT();
  return (
    <EditorColumns
      main={<ShareSections g={st.g} origin={origin} device={st.device} />}
      preview={<Preview st={st} data={data} hint={t("admin.preview.hint")} />}
    />
  );
}

/** The content of the active editor tab. */
export function EditorBody({
  st,
  data,
  origin,
  actionData,
}: TabProps & { origin?: string }) {
  const { g, tab } = st;
  return (
    <>
      {tab === "datos" && (
        <DatosTab st={st} data={data} actionData={actionData} />
      )}
      {tab === "fotos" && (
        <PhotosTab
          data={data}
          g={g}
          coverId={st.cover.coverId}
          actionData={actionData}
        />
      )}
      {tab === "portada" && (
        <CoverTab
          g={g}
          photos={data.photos}
          cover={st.cover}
          state={st.previewState}
          actionData={actionData}
        />
      )}
      {tab === "diseno" && (
        <DesignTab st={st} data={data} actionData={actionData} />
      )}
      {tab === "compartir" && <ShareTab st={st} data={data} origin={origin} />}
    </>
  );
}
