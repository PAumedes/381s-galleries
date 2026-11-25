import type { GalleryActionResult } from "../../lib/server/admin-galleries";
import { EditorBody } from "./gallery-edit/EditorBody";
import { EditorHeader } from "./gallery-edit/EditorHeader";
import type { GalleryEditData } from "./gallery-edit/types";
import { useGalleryEditorState } from "./gallery-edit/useEditorState";
import { GalleryTabs } from "./GalleryTabs";

export type { GalleryEditData };

type GalleryEditViewProps = {
  data: GalleryEditData;
  origin?: string;
  actionData: GalleryActionResult | undefined;
};

/**
 * Keyed by gallery id: the local copies of title / mode / design / device
 * must not survive a navigation between two galleries.
 */
export function GalleryEditView(props: GalleryEditViewProps) {
  return <GalleryEditViewInner key={props.data.gallery.id} {...props} />;
}

function GalleryEditViewInner(props: GalleryEditViewProps) {
  const { data, origin, actionData } = props;
  const st = useGalleryEditorState(data, actionData);
  const { g, tab } = st;
  const designDirty = st.draft.dirty;
  return (
    <div
      className={`flex flex-col gap-6 ${designDirty && tab === "diseno" ? "max-lg:pb-24" : ""}`}
    >
      <EditorHeader g={g} device={st.device} tab={tab} />
      <GalleryTabs
        id={g.id}
        current={tab}
        unsaved={designDirty ? ["diseno"] : []}
      />
      <EditorBody st={st} data={data} origin={origin} actionData={actionData} />
    </div>
  );
}
