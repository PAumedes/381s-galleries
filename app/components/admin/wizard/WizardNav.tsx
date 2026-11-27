import { useT } from "../../../i18n/use-t";
import {
  WIZARD_STEP_COUNT,
  wizardStepHref,
  type StepState,
} from "../../../lib/wizard";
import { WIZ_BTN, WIZ_BTN_PRIMARY } from "./ui";

/**
 * Back / Next / Skip as plain links (each step is its own URL, so it works
 * without JavaScript). A step that is not done offers Skip instead of Next.
 */
export function WizardNav({ step, state }: { step: number; state: StepState }) {
  const t = useT();
  const last = step === WIZARD_STEP_COUNT;
  const open = state === "todo" || state === "optional";
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {step > 1 && (
        <a href={wizardStepHref(step - 1)} className={WIZ_BTN}>
          {t("admin.wizard.back")}
        </a>
      )}
      {last ? (
        <a href="/admin" className={WIZ_BTN_PRIMARY}>
          {t("admin.wizard.finish")}
        </a>
      ) : (
        <a
          href={wizardStepHref(step + 1)}
          className={open ? WIZ_BTN : WIZ_BTN_PRIMARY}
        >
          {open ? t("admin.wizard.skip") : t("admin.wizard.next")}
        </a>
      )}
    </div>
  );
}
