import type { es } from "./es";
import type { Lang } from "./lang";

export type MessageKey = keyof typeof es;
type PluralBase<K extends string> = K extends `${infer B}.${"one" | "other"}`
  ? B
  : never;
export type TKey = MessageKey | PluralBase<MessageKey>;
export type Messages = Record<MessageKey, string>;
export type Vars = Record<string, string | number>;
export type TFunction = (key: TKey, vars?: Vars) => string;

export function interpolate(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : whole,
  );
}

export function plural(
  lang: Lang,
  count: number,
  forms: { one: string; other: string } & Partial<Record<string, string>>,
): string {
  const cat = new Intl.PluralRules(lang).select(count);
  return forms[cat] ?? forms.other;
}

export function makeT(lang: Lang, messages: Messages): TFunction {
  const dict = messages as Record<string, string>;
  return (key, vars) => {
    let template = dict[key];
    if (template === undefined && typeof vars?.count === "number") {
      const cat = new Intl.PluralRules(lang).select(vars.count);
      template = dict[`${key}.${cat}`] ?? dict[`${key}.other`];
    }
    return interpolate(template ?? key, vars);
  };
}
