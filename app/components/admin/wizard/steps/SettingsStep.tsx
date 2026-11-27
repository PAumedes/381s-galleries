import { useFormat } from "../../../../i18n/use-format";
import { useT } from "../../../../i18n/use-t";
import type {
  WizardData,
  WizardTarget,
} from "../../../../lib/server/admin-wizard";
import { wizardStepHref, type WizardStep } from "../../../../lib/wizard";
import { HelpLink } from "../../help/HelpLink";
import { StatusNote } from "../StatusNote";
import { StepFrame } from "../StepFrame";
import { WIZ_BTN_PRIMARY, WIZ_WRAP } from "../ui";
import { WizardText } from "../WizardText";
import { wizardStepKeys } from "../../../../lib/wizard";

/** The five key settings of the gallery as they are today, one short word each. */
function useCurrentValues(g: WizardTarget): string[] {
  const t = useT();
  const { dateTime } = useFormat();
  return [
    t(`admin.state.${g.status}`),
    g.pin ? t("admin.wizard.val.pinOn") : t("admin.wizard.val.pinOff"),
    t(`admin.mode.${g.mode}`),
    g.downloads ? t("admin.wizard.val.dlOn") : t("admin.wizard.val.dlOff"),
    g.expiresAt
      ? t("admin.wizard.val.expiryAt", { date: dateTime(g.expiresAt) })
      : t("admin.wizard.val.expiryNone"),
  ];
}

function SettingsList({ step, g }: { step: WizardStep; g: WizardTarget }) {
  const t = useT();
  const now = useCurrentValues(g);
  const keys = wizardStepKeys(step).lines;
  return (
    <ul data-settings className="flex max-w-prose flex-col gap-4">
      {keys.map((k, i) => (
        <li
          key={k}
          className="border-grey-200 flex flex-col gap-1 border-s-4 ps-3"
        >
          <span className="text-base leading-relaxed">
            <WizardText step={step} k={k} />
            {step.lines[i]?.help && <HelpLink topic={step.lines[i].help} />}
          </span>
          <strong className="text-base font-semibold">
            {t("admin.wizard.settings.now", { value: now[i]! })}
          </strong>
        </li>
      ))}
    </ul>
  );
}

/** 5: the key settings of the real gallery, with its current values and a link to where they are changed. */
export function SettingsStep({
  step,
  data,
}: {
  step: WizardStep;
  data: WizardData;
}) {
  const t = useT();
  const g = data.target;
  return (
    <StepFrame step={step} showLines={false}>
      {g ? (
        <>
          <StatusNote>
            <span className={WIZ_WRAP}>
              {t("admin.wizard.settings.for", { title: g.title })}
            </span>
          </StatusNote>
          <SettingsList step={step} g={g} />
          <div>
            <a href={`/admin/g/${g.id}`} className={WIZ_BTN_PRIMARY}>
              {t("admin.wizard.settings.open")}
            </a>
          </div>
        </>
      ) : (
        <>
          <StatusNote>{t("admin.wizard.settings.noGallery")}</StatusNote>
          <div>
            <a href={wizardStepHref(4)} className={WIZ_BTN_PRIMARY}>
              {t("admin.wizard.goStep", { n: 4 })}
            </a>
          </div>
        </>
      )}
    </StepFrame>
  );
}
