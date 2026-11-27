import { requireAdmin } from "./auth";

/**
 * Loader of the help page: it only checks the admin login (401 otherwise, like
 * every admin page). The page has no data of its own; the texts are admin-only
 * dictionary entries.
 */
export async function helpData(request: Request, e: Env): Promise<object> {
  await requireAdmin(request, e);
  return {};
}
