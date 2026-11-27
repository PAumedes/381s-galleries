import { HelpLink } from "./HelpLink";

/** Heading of an admin panel; with a help topic it carries a small "?" link. */
export function SectionTitle({
  title,
  help,
}: {
  title: string;
  /** Help topic: an item id of lib/help.ts. */
  help?: string;
}) {
  const heading = (
    <h2 className="text-micro text-grey-700 uppercase">{title}</h2>
  );
  if (!help) return heading;
  return (
    <div className="flex items-center gap-3">
      {heading}
      <HelpLink topic={help} />
    </div>
  );
}
