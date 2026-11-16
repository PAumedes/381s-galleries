import { useMemo } from "react";
import { useRouteLoaderData } from "react-router";

import type { loader as rootLoader } from "../root";
import { es } from "./es";
import { DEFAULT_LANG } from "./lang";
import { makeT, type TFunction } from "./t";

export function useLang() {
  return useRouteLoaderData<typeof rootLoader>("root")?.lang ?? DEFAULT_LANG;
}

export function useT(): TFunction {
  const data = useRouteLoaderData<typeof rootLoader>("root");
  const lang = data?.lang ?? DEFAULT_LANG;
  const messages = data?.messages ?? es;
  return useMemo(() => makeT(lang, messages), [lang, messages]);
}
