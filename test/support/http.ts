/** Full wire shape of a Response: status, body and every header (sorted). */
export async function shape(res: Response) {
  return {
    status: res.status,
    body: await res.clone().text(),
    headers: Object.fromEntries(
      [...res.headers.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
