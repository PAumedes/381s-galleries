import { useT } from "../../../i18n/use-t";
import type { CoverLayout, Palette } from "../../../lib/design";
import type { Versions } from "../../img-url";
import { LivePreview } from "../LivePreview";
import type { MobileCover } from "./types";
import type { useCoverEditor } from "./use-cover-editor";

/** Step 2: "Así se ve", the real cover at the chosen device, with unsaved focal points. */
export function LiveStep({
  editor,
  coverId,
  mobileCover,
  preview,
}: {
  editor: ReturnType<typeof useCoverEditor>;
  coverId: string | null;
  mobileCover: MobileCover | null;
  preview: {
    title: string;
    eventDate: string | null;
    palette: Palette;
    coverLayout: CoverLayout;
    proofing: boolean;
    versions?: Versions;
  };
}) {
  const t = useT();
  return (
    <div className="border-grey-200 flex min-w-0 flex-col border bg-white p-4 md:p-6 lg:sticky lg:top-6">
      <LivePreview
        heading={t("admin.cover.step2")}
        hint={t("admin.cover.step2Hint")}
        title={preview.title}
        eventDate={preview.eventDate}
        palette={preview.palette}
        coverLayout={preview.coverLayout}
        proofing={preview.proofing}
        cover={
          coverId
            ? { id: coverId, aspect: editor.deskAspect, focus: editor.focus }
            : null
        }
        mobileCover={
          mobileCover
            ? {
                id: mobileCover.id,
                aspect: editor.mobileAspect,
                focus: editor.mobileFocus,
              }
            : null
        }
        versions={preview.versions}
        device={editor.device}
        onDevice={editor.setDevice}
      />
    </div>
  );
}
