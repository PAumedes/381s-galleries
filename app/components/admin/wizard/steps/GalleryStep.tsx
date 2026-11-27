import { Form } from "react-router";

import { useT } from "../../../../i18n/use-t";
import type { WizardData } from "../../../../lib/server/admin-wizard";
import { wizardStepHref, type WizardStep } from "../../../../lib/wizard";
import { StatusNote } from "../StatusNote";
import { StepFrame } from "../StepFrame";
import { WIZ_BTN_PRIMARY, WIZ_LINK, WIZ_WRAP } from "../ui";
import { WizardSubmit } from "../WizardSubmit";

/** 4: the Drive folder becomes a gallery; the real sync button and the galleries found so far. */
export function GalleryStep({
  step,
  data,
}: {
  step: WizardStep;
  data: WizardData;
}) {
  const t = useT();
  const { count, recent } = data.galleries;
  return (
    <StepFrame step={step}>
      {!data.driveReady ? (
        <>
          <StatusNote>{t("admin.wizard.gallery.needDrive")}</StatusNote>
          <div>
            <a href={wizardStepHref(1)} className={WIZ_BTN_PRIMARY}>
              {t("admin.wizard.goStep", { n: 1 })}
            </a>
          </div>
        </>
      ) : (
        <>
          <StatusNote>
            {count > 0
              ? t("admin.wizard.gallery.some", { count })
              : t("admin.wizard.gallery.none")}
          </StatusNote>
          {recent.length > 0 && (
            <ul className="flex max-w-prose flex-col">
              {recent.map((g) => (
                <li key={g.id}>
                  <a
                    href={`/admin/g/${g.id}`}
                    className={`${WIZ_LINK} ${WIZ_WRAP}`}
                  >
                    {g.title}
                    {" · "}
                    {t(`admin.state.${g.status}`)}
                  </a>
                </li>
              ))}
              {count > recent.length && (
                <li className="text-base">
                  {t("admin.wizard.gallery.more", {
                    count: count - recent.length,
                  })}
                </li>
              )}
            </ul>
          )}
          <Form method="post" action="/admin/setup">
            <input type="hidden" name="intent" value="sync" />
            <WizardSubmit
              label={t("admin.setup.sync.now")}
              primary={count === 0}
            />
          </Form>
        </>
      )}
    </StepFrame>
  );
}
