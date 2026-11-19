import type { Plugin } from "vite";

/**
 * Admin-only client chunks are emitted under this directory (next to
 * `assets/`). It must match ADMIN_ASSET_PREFIX (app/lib/server/admin-assets.ts)
 * and `assets.run_worker_first` in wrangler.jsonc.
 */
export const ADMIN_DIR = "admin-assets";

/** Route modules that only the admin uses (`admin.*`, `api.admin.*`). */
export function isAdminRouteId(id: string): boolean {
  const file = id.split("?")[0];
  return /\/app\/routes\/(admin|api\.admin)\./.test(file);
}

/**
 * Modules no public page can reach: everything not reachable (through static
 * or dynamic imports) from a public root. A module shared with a public page
 * stays public.
 */
export function findAdminOnlyModules(
  allIds: Iterable<string>,
  publicRoots: Iterable<string>,
  importsOf: (id: string) => readonly string[],
): Set<string> {
  const reachable = new Set<string>();
  const stack = [...publicRoots];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (reachable.has(id)) continue;
    reachable.add(id);
    stack.push(...importsOf(id));
  }
  const adminOnly = new Set<string>();
  for (const id of allIds) if (!reachable.has(id)) adminOnly.add(id);
  return adminOnly;
}

/** Output pattern for a chunk: the admin directory only if ALL its modules are admin-only. */
export function chunkFileNameFor(
  moduleIds: readonly string[],
  adminOnly: ReadonlySet<string>,
  publicDir: string,
): string {
  // Virtual helpers (\0...) don't decide: they carry no app code.
  const real = moduleIds.filter((id) => !id.startsWith("\0"));
  const admin = real.length > 0 && real.every((id) => adminOnly.has(id));
  return `${admin ? ADMIN_DIR : publicDir}/[name]-[hash].js`;
}

type ChunkInfo = { moduleIds: string[] };
type NameOption = string | ((chunk: never) => string) | undefined;

/**
 * Client build only: routes admin-only chunks into ADMIN_DIR so Workers Static
 * Assets can be told to run the Worker first for that path. React Router's
 * manifest and modulepreload links are built from the emitted file names, so
 * they follow automatically.
 */
export function adminChunks(): Plugin {
  const adminOnly = new Set<string>();
  return {
    name: "admin-chunks",
    apply: "build",
    applyToEnvironment: (env) => env.name === "client",
    buildEnd() {
      adminOnly.clear();
      const ids = [...this.getModuleIds()];
      const roots = ids.filter(
        (id) => this.getModuleInfo(id)?.isEntry && !isAdminRouteId(id),
      );
      const found = findAdminOnlyModules(ids, roots, (id) => {
        const info = this.getModuleInfo(id);
        return [
          ...(info?.importedIds ?? []),
          ...(info?.dynamicallyImportedIds ?? []),
        ];
      });
      for (const id of found) adminOnly.add(id);
    },
    outputOptions(options) {
      const wrap = (original: NameOption, fallback: string) =>
        ((chunk: ChunkInfo) => {
          const pattern = chunkFileNameFor(
            chunk.moduleIds,
            adminOnly,
            "assets",
          );
          if (pattern.startsWith(`${ADMIN_DIR}/`)) return pattern;
          if (typeof original === "function") {
            return (original as (c: ChunkInfo) => string)(chunk);
          }
          return original ?? fallback;
        }) as never;
      return {
        ...options,
        entryFileNames: wrap(options.entryFileNames, "assets/[name]-[hash].js"),
        chunkFileNames: wrap(options.chunkFileNames, "assets/[name]-[hash].js"),
      };
    },
  };
}
