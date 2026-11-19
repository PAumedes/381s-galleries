/** Form column plus the sticky live-preview column of the editor tabs. */
export function EditorColumns({
  main,
  preview,
  previewFirst = false,
}: {
  main: React.ReactNode;
  preview: React.ReactNode;
  previewFirst?: boolean;
}) {
  return (
    <div
      data-editor-grid=""
      className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10 2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
    >
      <div className="flex min-w-0 flex-col gap-8">{main}</div>
      <aside
        data-preview-column=""
        className={`min-w-0 lg:sticky lg:top-6 ${previewFirst ? "order-first lg:order-none" : ""}`}
      >
        {preview}
      </aside>
    </div>
  );
}
