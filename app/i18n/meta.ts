import { es } from "./es";
import { DEFAULT_LANG, type Lang } from "./lang";
import { makeT, type Messages, type TFunction } from "./t";

type RootData = { lang?: Lang; messages?: Messages } | undefined;

/** Translator for a route `meta` function, from the root loader data in `matches`. */
export function metaT(
  matches: ReadonlyArray<{ id: string; loaderData?: unknown } | undefined>,
): TFunction {
  const root = matches.find((m) => m?.id === "root")?.loaderData as RootData;
  return makeT(root?.lang ?? DEFAULT_LANG, root?.messages ?? es);
}

/**
 * The part of a route's `meta` args we use. Typing it by hand (instead of
 * `Route.MetaArgs`) avoids a circular type: `matches` would reference this
 * very `meta`.
 */
export type MetaMatches = { matches: Parameters<typeof metaT>[0] };
