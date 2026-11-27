import { useNavigation } from "react-router";

import { useT } from "../../i18n/use-t";
import { BuildInfo } from "./BuildInfo";
import { BrandSection } from "./setup/BrandSection";
import { DriveSection } from "./setup/DriveSection";
import { IgnoredSection } from "./setup/IgnoredSection";
import { LogoCard } from "./setup/LogoCard";
import { RootSection } from "./setup/RootSection";
import { SweepSection } from "./setup/SweepSection";
import { SyncSection } from "./setup/SyncSection";
import type { SetupActionData, SetupViewData } from "./setup/types";

export type { SetupActionData, SetupViewData } from "./setup/types";

export function SetupView({
  data,
  actionData,
}: {
  data: SetupViewData;
  actionData: SetupActionData | undefined;
}) {
  const t = useT();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const props = { data, actionData, busy };
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-title text-ink">{t("admin.setup.title")}</h1>

      <div
        data-testid="setup-cards"
        className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4"
      >
        <DriveSection {...props} />
        <RootSection {...props} />
        <SyncSection {...props} />
        <BrandSection {...props} />
      </div>

      <LogoCard
        logo={data.logo ?? { onLight: null, onDark: null }}
        actionData={actionData}
        busy={busy}
      />

      <IgnoredSection
        folders={data.ignoredFolders ?? []}
        actionData={actionData}
        busy={busy}
      />
      <SweepSection actionData={actionData} />
      <BuildInfo />
    </div>
  );
}
