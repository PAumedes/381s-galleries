import { useT } from "../../i18n/use-t";
import { readBuildInfo } from "../../lib/build-info";

/** Small "which deploy is this" footer for the admin settings page. */
export function BuildInfo({
  sha = readBuildInfo().sha,
  date = readBuildInfo().date,
}: {
  sha?: string;
  date?: string | null;
}) {
  const t = useT();
  const id = date ? `${sha} · ${date}` : sha;
  return (
    <p data-testid="build-id" className="text-small text-grey-600">
      {t("admin.setup.build", { id })}
    </p>
  );
}
