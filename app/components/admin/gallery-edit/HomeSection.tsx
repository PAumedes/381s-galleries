import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import type { EditGallery } from "./types";
import { btnPrimary, Feedback, Section } from "./ui";

export function HomeSection({
  g,
  busy,
  actionData,
}: {
  g: EditGallery;
  busy: boolean;
  actionData: GalleryActionResult | undefined;
}) {
  const t = useT();
  // Not offered while the home query would hide the gallery anyway.
  const homeBlocked = g.hasPin || g.status !== "published";

  return (
    <Section title={t("admin.edit.section.home")} help="albums-home">
      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="home" />
        {/* A checkbox submits nothing when off: the hidden 0 comes first. */}
        <input type="hidden" name="showOnHome" value="0" />
        <div className="flex items-start gap-2">
          <input
            id="show-on-home"
            type="checkbox"
            name="showOnHome"
            value="1"
            defaultChecked={g.showOnHome}
            disabled={homeBlocked}
            aria-describedby="show-on-home-hint"
            className="mt-2.5 size-6 md:mt-1 md:size-4"
          />
          <div>
            <label
              htmlFor="show-on-home"
              className="text-small flex min-h-tap items-center md:min-h-0"
            >
              {t("admin.edit.home.label")}
            </label>
            <p id="show-on-home-hint" className="text-small text-grey-600">
              {g.hasPin
                ? t("admin.edit.home.hintPin")
                : g.status !== "published"
                  ? t("admin.edit.home.hintUnpublished")
                  : t("admin.edit.home.hint")}
            </p>
          </div>
        </div>
        <div>
          <button
            type="submit"
            className={btnPrimary}
            disabled={busy || homeBlocked}
          >
            {t("admin.edit.home.save")}
          </button>
        </div>
        <Feedback data={actionData} intent="home" />
      </Form>
    </Section>
  );
}
