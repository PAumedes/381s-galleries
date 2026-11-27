import { useT } from "../../../i18n/use-t";
import { WIZARD_STEP_COUNT } from "../../../lib/wizard";

/** "Paso 3 de 6" as words, plus a bar that only repeats it (hidden from screen readers). */
export function WizardProgress({ step }: { step: number }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink text-base font-semibold">
        {t("admin.wizard.progress", { n: step, total: WIZARD_STEP_COUNT })}
      </p>
      <div aria-hidden="true" className="bg-grey-200 h-2 w-full">
        <div
          data-progress-bar
          className="bg-ink h-full"
          style={{ width: `${(step / WIZARD_STEP_COUNT) * 100}%` }}
        />
      </div>
    </div>
  );
}
