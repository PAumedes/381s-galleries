import { useT } from "../i18n/use-t";
import { LanguageToggle } from "./LanguageToggle";
import { Logo } from "./Logo";
import { useStudioName } from "../lib/use-studio-name";

const SECTIONS = [
  ["privacy.who.title", "privacy.who.body"],
  ["privacy.access.title", "privacy.access.body"],
  ["privacy.stored.title", "privacy.stored.body"],
  ["privacy.visit.title", "privacy.visit.body"],
  ["privacy.ip.title", "privacy.ip.body"],
  ["privacy.purpose.title", "privacy.purpose.body"],
  ["privacy.retention.title", "privacy.retention.body"],
  ["privacy.sharing.title", "privacy.sharing.body"],
] as const;

export function PrivacyPage({
  contactEmail,
}: {
  contactEmail?: string | null;
}) {
  const t = useT();
  const studio = useStudioName();
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-6 py-section">
      <a href="/" className="self-start">
        <Logo variant="dark" className="h-16" />
      </a>
      <h1 className="text-micro-label text-grey-600 uppercase">
        {t("privacy.title")}
      </h1>
      {SECTIONS.map(([title, body]) => (
        <section key={title} className="flex flex-col gap-2">
          <h2 className="text-micro-label uppercase">{t(title)}</h2>
          <p className="text-body text-grey-600">{t(body, { studio })}</p>
        </section>
      ))}
      <section className="flex flex-col gap-2">
        <h2 className="text-micro-label uppercase">
          {t("privacy.contact.title")}
        </h2>
        <p className="text-body text-grey-600">
          {contactEmail ? (
            <>
              {t("privacy.contact.lead")}{" "}
              <a className="underline" href={`mailto:${contactEmail}`}>
                {contactEmail}
              </a>
            </>
          ) : (
            t("privacy.contact.generic")
          )}
        </p>
      </section>
      <footer className="flex flex-col items-center gap-4">
        <a href="/" className="text-micro-label text-grey-600 uppercase">
          {t("privacy.back")}
        </a>
        <LanguageToggle className="text-grey-600" />
      </footer>
    </main>
  );
}
