import { allMessages } from "../../../i18n/dictionaries";
import { DEFAULT_LANG, type Lang } from "../../../i18n/lang";
import { makeT } from "../../../i18n/t";
import { getDb } from "../../../db";
import { CSV_BOM, csvLine, fmtStudioSeconds } from "../../admin-activity";
import { validTimezone } from "../../studio-time";
import { activityQuery } from "../activity";
import { adminHeaders } from "../admin";
import { loadGallery, photoMap } from "./shared";

const CSV_CHUNK = 200;
const CSV_COLUMNS = [
  "admin.export.col.when_utc",
  "admin.export.col.when_ar",
  "admin.export.col.email",
  "admin.export.col.photo",
  "admin.export.col.set",
  "admin.export.col.size",
  "admin.export.col.kind",
  "admin.export.col.bulkId",
  "admin.export.col.country",
  "admin.export.col.region",
  "admin.export.col.city",
  "admin.export.col.continent",
  "admin.export.col.timezone",
  "admin.export.col.asn",
  "admin.export.col.asOrg",
  "admin.export.col.lang",
  "admin.export.col.referrer",
  "admin.export.col.browser",
  "admin.export.col.browserVersion",
  "admin.export.col.os",
  "admin.export.col.device",
] as const;

type CsvSource = Awaited<ReturnType<typeof activityQuery>>[number];

/** One export row, in CSV_COLUMNS order. */
function csvRow(
  r: CsvSource,
  p: { name: string; set: string } | undefined,
  tz: string,
  labels: { size: (v: string) => string; kind: (v: string) => string },
) {
  return [
    r.createdAt,
    fmtStudioSeconds(r.createdAt, tz),
    r.email,
    p?.name,
    p?.set,
    labels.size(r.variant),
    labels.kind(r.kind),
    r.photoId === null ? r.id : r.bulkId,
    r.country,
    r.region,
    r.city,
    r.continent,
    r.timezone,
    r.asn,
    r.asOrg,
    r.lang,
    r.referrerHost,
    r.browser,
    r.browserVersion,
    r.os,
    r.device,
  ];
}

/** CSV of every download row, newest first, streamed in keyset pages. */
export async function activityCsv(
  env: Env,
  id: string,
  lang: Lang = DEFAULT_LANG,
): Promise<Response | null> {
  const g = await loadGallery(env, id);
  if (!g) return null;
  const t = makeT(lang, allMessages(lang));
  const sizeLabel = (v: string) =>
    v === "highres"
      ? t("admin.size.highres")
      : v === "web"
        ? t("admin.size.web")
        : v === "ig"
          ? t("admin.size.ig")
          : v;
  const kindLabel = (v: string) =>
    v === "single"
      ? t("admin.export.kind.single")
      : v === "bulk"
        ? t("admin.export.kind.bulk")
        : v;
  const db = getDb(env);
  const tz = validTimezone(env.TIMEZONE);
  const photos = await photoMap(env, id);
  const enc = new TextEncoder();
  let cursor: { createdAt: string; id: string } | undefined;
  let started = false;
  let done = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (!started) {
        started = true;
        ctrl.enqueue(
          enc.encode(CSV_BOM + csvLine(CSV_COLUMNS.map((k) => t(k)))),
        );
        return;
      }
      if (done) return ctrl.close();
      const rows = await activityQuery(db, id, {
        before: cursor,
        limit: CSV_CHUNK,
      });
      let out = "";
      for (const r of rows) {
        const p = r.photoId ? photos.get(r.photoId) : undefined;
        out += csvLine(
          csvRow(r, p, tz, {
            size: sizeLabel,
            kind: kindLabel,
          }),
        );
      }
      if (out) ctrl.enqueue(enc.encode(out));
      if (rows.length < CSV_CHUNK) {
        done = true;
        return ctrl.close();
      }
      const l = rows[rows.length - 1];
      cursor = { createdAt: l.createdAt, id: l.id };
    },
  });
  return new Response(body, {
    headers: {
      ...adminHeaders(),
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${g.slug}-${t("admin.export.file.activity")}.csv"`,
    },
  });
}
