import { useT } from "../../../i18n/use-t";
import { HELP_SECTIONS } from "../../../lib/help";
import { resolveHelpItem } from "../../../lib/help-text";
import { wizardStepKeys, type WizardStep } from "../../../lib/wizard";
import { HelpLink } from "../help/HelpLink";
import { WIZ_LINK } from "./ui";
import { WizardText } from "./WizardText";

const HELP_ITEMS = HELP_SECTIONS.flatMap((s) => s.items);

/** The link at the bottom of a step to a help answer: its question is the text. */
function MoreHelp({ topic }: { topic: string }) {
  const t = useT();
  const item = HELP_ITEMS.find((i) => i.id === topic);
  if (!item) return null;
  return (
    <a
      href={`/admin/ayuda#${topic}`}
      target="_blank"
      rel="noopener"
      className={WIZ_LINK}
    >
      {t("admin.wizard.moreHelp", { title: resolveHelpItem(item, t).q })}
    </a>
  );
}

/**
 * The frame every step shares: title, lead, the short lines (unless the step
 * draws its own), what the step needs (children) and the help links.
 */
export function StepFrame({
  step,
  showLines = true,
  children,
}: {
  step: WizardStep;
  showLines?: boolean;
  children?: React.ReactNode;
}) {
  const t = useT();
  const k = wizardStepKeys(step);
  return (
    <section
      aria-labelledby={`wizard-${step.id}`}
      className="flex flex-col gap-4"
    >
      <h2
        id={`wizard-${step.id}`}
        tabIndex={-1}
        className="text-ink text-xl font-semibold focus:outline-none"
      >
        {t(k.title)}
      </h2>
      <p className="text-ink max-w-prose text-base leading-relaxed">
        <WizardText step={step} k={k.lead} />
      </p>
      {showLines && (
        <ul className="flex max-w-prose list-disc flex-col gap-2 ps-6 text-base leading-relaxed">
          {k.lines.map((line, i) => (
            <li key={line}>
              <WizardText step={step} k={line} />
              {step.lines[i]?.help && <HelpLink topic={step.lines[i].help} />}
            </li>
          ))}
        </ul>
      )}
      {children}
      {step.help.length > 0 && (
        <div className="flex flex-col">
          {step.help.map((h) => (
            <MoreHelp key={h} topic={h} />
          ))}
        </div>
      )}
    </section>
  );
}
