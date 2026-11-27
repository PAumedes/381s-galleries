import { useT } from "../../../../i18n/use-t";
import type { WizardData } from "../../../../lib/server/admin-wizard";
import { wizardStepHref, type WizardStep } from "../../../../lib/wizard";
import { CopyField } from "../CopyField";
import { StatusNote } from "../StatusNote";
import { StepFrame } from "../StepFrame";
import { WIZ_BTN_PRIMARY } from "../ui";

/** 6: the real link of the gallery (and of its client page) to copy. */
export function ShareStep({
  step,
  data,
}: {
  step: WizardStep;
  data: WizardData;
}) {
  const t = useT();
  const g = data.target;
  return (
    <StepFrame step={step}>
      {g ? (
        g.status !== "published" ? (
          <StatusNote>{t("admin.wizard.share.draft")}</StatusNote>
        ) : (
          <>
            <CopyField
              label={t("admin.wizard.share.linkLabel")}
              value={g.url}
            />
            {g.clientUrl && (
              <CopyField
                label={t("admin.wizard.share.clientLinkLabel")}
                value={g.clientUrl}
              />
            )}
            {g.pin && (
              <p className="text-base">{t("admin.wizard.share.pin")}</p>
            )}
            {g.clientPin && (
              <p className="text-base">{t("admin.wizard.share.clientPin")}</p>
            )}
          </>
        )
      ) : (
        <>
          <StatusNote>{t("admin.wizard.share.noGallery")}</StatusNote>
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
