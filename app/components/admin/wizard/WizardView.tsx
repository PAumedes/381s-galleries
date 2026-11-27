import { useT } from "../../../i18n/use-t";
import type {
  WizardActionResult,
  WizardData,
} from "../../../lib/server/admin-wizard";
import { WIZARD_STEPS } from "../../../lib/wizard";
import { ClientStep } from "./steps/ClientStep";
import { DriveStep } from "./steps/DriveStep";
import { FoldersStep } from "./steps/FoldersStep";
import { GalleryStep } from "./steps/GalleryStep";
import { SettingsStep } from "./steps/SettingsStep";
import { ShareStep } from "./steps/ShareStep";
import { WizardNav } from "./WizardNav";
import { WizardProgress } from "./WizardProgress";
import { WizardStepList } from "./WizardStepList";

function StepBody({
  data,
  actionData,
}: {
  data: WizardData;
  actionData: WizardActionResult | undefined;
}) {
  const step = WIZARD_STEPS[data.step - 1]!;
  switch (step.id) {
    case "drive":
      return <DriveStep step={step} data={data} />;
    case "folders":
      return <FoldersStep step={step} />;
    case "client":
      return <ClientStep step={step} data={data} actionData={actionData} />;
    case "gallery":
      return <GalleryStep step={step} data={data} />;
    case "settings":
      return <SettingsStep step={step} data={data} />;
    case "share":
      return <ShareStep step={step} data={data} />;
  }
}

/** The first-steps wizard (T6.58): one step per URL, its real state, Back / Next / Skip. */
export function WizardView({
  data,
  actionData,
}: {
  data: WizardData;
  actionData?: WizardActionResult | undefined;
}) {
  const t = useT();
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-title text-ink">{t("admin.wizard.title")}</h1>
        <p className="text-ink max-w-prose text-base leading-relaxed">
          {t("admin.wizard.intro")}
        </p>
        <WizardProgress step={data.step} />
      </header>
      <StepBody data={data} actionData={actionData} />
      <WizardNav step={data.step} state={data.states[data.step - 1]!} />
      <WizardStepList step={data.step} states={data.states} />
    </div>
  );
}
