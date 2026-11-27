import { useT } from "../../../../i18n/use-t";
import type { WizardData } from "../../../../lib/server/admin-wizard";
import type { WizardStep } from "../../../../lib/wizard";
import { StatusNote } from "../StatusNote";
import { StepFrame } from "../StepFrame";
import { WIZ_BTN_PRIMARY, WIZ_WRAP } from "../ui";

/** 1: Drive connected and a folder chosen, from the real settings. */
export function DriveStep({
  step,
  data,
}: {
  step: WizardStep;
  data: WizardData;
}) {
  const t = useT();
  const needsConnect = !data.mock && !data.connected;
  return (
    <StepFrame step={step}>
      <StatusNote>
        {data.mock
          ? t("admin.setup.drive.demo")
          : !data.connected
            ? t("admin.wizard.drive.notConnected")
            : data.rootName
              ? t("admin.wizard.drive.connected")
              : t("admin.wizard.drive.noRoot")}
      </StatusNote>
      {data.rootName && !data.mock && (
        <p className={`text-base ${WIZ_WRAP}`}>
          {t("admin.wizard.drive.root", { root: data.rootName })}
        </p>
      )}
      {!data.driveReady && (
        <div>
          {needsConnect ? (
            <a href="/admin/google/connect" className={WIZ_BTN_PRIMARY}>
              {t("admin.setup.connect")}
            </a>
          ) : (
            <a href="/admin/setup" className={WIZ_BTN_PRIMARY}>
              {t("admin.wizard.drive.openSettings")}
            </a>
          )}
        </div>
      )}
      {data.driveReady && !data.mock && (
        <div>
          <a
            href="/admin/setup"
            className="focus-visible:outline-ink inline-flex min-h-12 items-center text-base underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("admin.wizard.drive.openSettings")}
          </a>
        </div>
      )}
    </StepFrame>
  );
}
