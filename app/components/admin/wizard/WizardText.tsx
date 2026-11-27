import { HelpText } from "../help/HelpText";
import { useT } from "../../../i18n/use-t";
import type { MessageKey } from "../../../i18n/t";
import type { WizardStep } from "../../../lib/wizard";

/** One wizard text: button names in bold between « », folder names as code, the rest plain. */
export function WizardText({
  step,
  k,
}: {
  step: Pick<WizardStep, "labels" | "values">;
  k: MessageKey;
}) {
  const t = useT();
  return <HelpText raw={t(k)} item={step} />;
}
