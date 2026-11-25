import { useFormat } from "../../../i18n/use-format";

export function Card({ label, value }: { label: string; value: number }) {
  const { number } = useFormat();
  return (
    <div className="border-grey-200 flex flex-col gap-1 border p-4">
      <p className="text-micro text-grey-700 uppercase">{label}</p>
      <p className="text-title text-ink">{number(value)}</p>
    </div>
  );
}
