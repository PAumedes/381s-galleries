import type { loadActivity } from "../../../lib/server/admin-activity";

export type ActivityViewData = NonNullable<
  Awaited<ReturnType<typeof loadActivity>>
>;
export type Row = ActivityViewData["rows"][number];
