import { SectionTitle } from "../help/SectionTitle";
import type { SetupActionData } from "./types";

export const btn =
  "text-micro uppercase border border-ink px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
export const btnPrimary = `${btn} bg-ink text-paper`;
export const input =
  "border-grey-300 bg-white w-full border px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function Section({
  title,
  help,
  children,
}: {
  title: string;
  /** Help topic (an item id of lib/help.ts): adds a small "?" next to the title. */
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-grey-200 flex min-w-0 flex-col gap-3 border p-5">
      <SectionTitle title={title} help={help} />
      {children}
    </section>
  );
}

export function Feedback({
  data,
  intent,
}: {
  data: SetupActionData | undefined;
  intent: string;
}) {
  if (!data || data.intent !== intent) return null;
  if (!data.ok)
    return (
      <p role="alert" className="border-ink border p-3 text-small">
        {data.error}
      </p>
    );
  return data.message ? (
    <p role="status" className="text-small text-grey-700">
      {data.message}
    </p>
  ) : null;
}
