import { useT } from "../../../i18n/use-t";
import {
  WIZARD_STEPS,
  wizardStepHref,
  wizardStepKeys,
  type StepState,
} from "../../../lib/wizard";

/** Every step with its real state as a word; the current one is marked for assistive tech. */
export function WizardStepList({
  step,
  states,
}: {
  step: number;
  states: readonly StepState[];
}) {
  const t = useT();
  return (
    <nav aria-label={t("admin.wizard.steps")}>
      <ol className="border-grey-200 flex flex-col border-t">
        {WIZARD_STEPS.map((s, i) => (
          <li key={s.id} className="border-grey-200 border-b">
            <a
              href={wizardStepHref(i + 1)}
              aria-current={i + 1 === step ? "step" : undefined}
              className={`focus-visible:outline-ink flex min-h-12 items-center gap-3 px-2 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${i + 1 === step ? "bg-grey-100 font-semibold" : "hover:bg-grey-50"}`}
            >
              <span aria-hidden="true" className="w-6 shrink-0 text-center">
                {states[i] === "done" ? "✓" : i + 1}
              </span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {t(wizardStepKeys(s).title)}
              </span>
              <span className="text-grey-800 shrink-0 text-base">
                {t(`admin.wizard.state.${states[i]!}`)}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
