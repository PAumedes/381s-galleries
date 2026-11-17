import { useContext, useMemo } from "react";
import { UNSAFE_DataRouterDataContext } from "react-router";

import { es } from "./es";
import { DEFAULT_LANG, type Lang } from "./lang";
import { makeT, type Messages, type TFunction } from "./t";

type RootData = { lang?: Lang; messages?: Messages } | undefined;

/**
 * Root loader data, or undefined when rendered outside a data router (leaf
 * components such as the QR code are unit-tested without one; they then fall
 * back to Spanish). Same data `useRouteLoaderData("root")` returns.
 */
function useRootData(): RootData {
  const data = useContext(UNSAFE_DataRouterDataContext);
  return data?.loaderData?.root as RootData;
}

export function useLang(): Lang {
  return useRootData()?.lang ?? DEFAULT_LANG;
}

export function useT(): TFunction {
  const data = useRootData();
  const lang = data?.lang ?? DEFAULT_LANG;
  const messages = data?.messages ?? es;
  return useMemo(() => makeT(lang, messages), [lang, messages]);
}
