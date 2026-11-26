import type { GalleryMode } from "../../../lib/constants";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import { DangerSection } from "./DangerSection";
import { DetailsSection } from "./DetailsSection";
import { HomeSection } from "./HomeSection";
import { VersioningSection } from "./VersioningSection";
import { OptionsSection } from "./OptionsSection";
import { PinSection } from "./PinSection";
import { StatusSection } from "./StatusSection";
import { fieldErrorsOf } from "./field-errors";
import type { EditGallery, GalleryEditData } from "./types";

type DatosSectionsProps = {
  g: EditGallery;
  data: GalleryEditData;
  proofing: boolean;
  onMode: (m: GalleryMode) => void;
  title: string;
  onTitle: (v: string) => void;
  eventDate: string;
  onEventDate: (v: string) => void;
  busy: boolean;
  actionData: GalleryActionResult | undefined;
};

/** Datos tab: details, status, PIN, home, options and the danger zone. */
export function DatosSections(p: DatosSectionsProps) {
  const { g, data, busy, actionData } = p;
  return (
    <>
      <DetailsSection
        g={g}
        clients={data.clients}
        errors={fieldErrorsOf(actionData, "details")}
        title={p.title}
        onTitle={p.onTitle}
        eventDate={p.eventDate}
        onEventDate={p.onEventDate}
        busy={busy}
        actionData={actionData}
      />
      <StatusSection
        status={g.status}
        cacheProgress={data.cacheProgress}
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
      <VersioningSection g={g} busy={busy} actionData={actionData} />
      <OptionsSection
        g={g}
        data={data}
        proofing={p.proofing}
        onMode={p.onMode}
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
  );
}
