import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import type { EditGallery } from "./types";
import { btnPrimary, Feedback, Section } from "./ui";

/** Opt-in to photo versions (T6.53b2): names like IMG_v2 become versions of IMG. */
export function VersioningSection({
  g,
  busy,
  actionData,
}: {
  g: EditGallery;
  busy: boolean;
  actionData: GalleryActionResult | undefined;
}) {
  const t = useT();
  return (
    <Section title={t("admin.edit.section.versions")} help="versions-on">
      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="versioning" />
        {/* A checkbox submits nothing when off: the hidden 0 comes first. */}
        <input type="hidden" name="versioning" value="0" />
        <div className="flex items-start gap-2">
          <input
            id="versioning"
            type="checkbox"
            name="versioning"
            value="1"
            defaultChecked={g.versioning}
            aria-describedby="versioning-hint"
            className="mt-2.5 size-6 md:mt-1 md:size-4"
          />
          <div>
            <label
              htmlFor="versioning"
              className="text-small flex min-h-tap items-center md:min-h-0"
            >
              {t("admin.edit.versions.label")}
            </label>
            <p id="versioning-hint" className="text-small text-grey-600">
              {t("admin.edit.versions.hint")}
            </p>
          </div>
        </div>
        <div>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {t("admin.edit.versions.save")}
          </button>
        </div>
        <Feedback data={actionData} intent="versioning" />
      </Form>
    </Section>
  );
}
