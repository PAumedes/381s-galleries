import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import { WIZARD_PATH } from "../../../lib/wizard";
import { WizardSubmit } from "./WizardSubmit";
import { WIZ_BTN_PRIMARY } from "./ui";

/**
 * Card on the admin home while there is no gallery or Drive is not connected.
 * It never blocks anything: a link to the guide and "No mostrar más" (a plain
 * form post that remembers the choice).
 */
export function WizardBanner() {
  const t = useT();
  return (
    <section
      aria-labelledby="wizard-banner-title"
      className="border-ink flex flex-col gap-3 border-2 p-4"
    >
      <h2 id="wizard-banner-title" className="text-ink text-xl font-semibold">
        {t("admin.wizard.banner.title")}
      </h2>
      <p className="text-ink max-w-prose text-base leading-relaxed">
        {t("admin.wizard.banner.text")}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <a href={WIZARD_PATH} className={WIZ_BTN_PRIMARY}>
          {t("admin.wizard.banner.open")}
        </a>
        <Form method="post" action={WIZARD_PATH}>
          <input type="hidden" name="intent" value="dismiss" />
          <WizardSubmit
            label={t("admin.wizard.banner.dismiss")}
            primary={false}
          />
        </Form>
      </div>
    </section>
  );
}
