import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { resolveExpiry, validTimezone } from "../../../studio-time";
import { isValidDate } from "../../../admin-gallery";
import { RESERVED_SLUGS, SLUG_MAX, SLUG_RE } from "../../slug";
import { slugInUse } from "../../slug-namespace";
import { isExpired } from "../../time";
import { isAssignedTo, planClientChange } from "./client-assignment";
import { CONTROL_RE, done, fail, str } from "./shared";
import type { GalleryRow } from "./shared";

const EXPIRY_YEAR_MIN = 2000;
const EXPIRY_YEAR_MAX = 2100;
export const TITLE_MAX = 120;
export const CLIENT_MAX = 120;
export { SLUG_MAX };

export async function saveDetails(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
) {
  const intent = "details";
  const errors: Record<string, string> = {};

  const title = str(f, "title").trim();
  if (title.length < 1 || title.length > TITLE_MAX || CONTROL_RE.test(title))
    errors.title = t("admin.msg.titleLength", { max: TITLE_MAX });

  const clientRaw = str(f, "clientName").trim();
  if (clientRaw.length > CLIENT_MAX || CONTROL_RE.test(clientRaw))
    errors.clientName = t("admin.msg.clientLength", { max: CLIENT_MAX });

  const slug = str(f, "slug").trim().toLowerCase();
  if (RESERVED_SLUGS.includes(slug)) errors.slug = t("admin.msg.slugReserved");
  else if (!slug || slug.length > SLUG_MAX || !SLUG_RE.test(slug))
    errors.slug = t("admin.msg.slugFormat", { max: SLUG_MAX });

  const eventDate = str(f, "eventDate").trim();
  if (eventDate && !isValidDate(eventDate))
    errors.eventDate = t("admin.msg.eventDateInvalid");

  const expDate = str(f, "expiresDate").trim();
  const expTime = str(f, "expiresTime").trim();
  let expiresAt: string | null = null;
  if (expDate || expTime) {
    const yr = Number(expDate.slice(0, 4));
    if (expDate && (yr < EXPIRY_YEAR_MIN || yr > EXPIRY_YEAR_MAX))
      errors.expires = t("admin.msg.expiryYear", {
        min: EXPIRY_YEAR_MIN,
        max: EXPIRY_YEAR_MAX,
      });
    else {
      // A date without a time means "until the end of that day" (studio time).
      expiresAt = expDate
        ? resolveExpiry(
            expDate,
            expTime || "23:59",
            g.expiresAt,
            validTimezone(env.TIMEZONE),
          )
        : null;
      if (!expiresAt)
        errors.expires = expDate
          ? t("admin.msg.expiryInvalid")
          : t("admin.msg.expiryNeedsDate");
    }
  }

  if (
    !errors.slug &&
    slug !== g.slug.toLowerCase() &&
    (await slugTaken(env, slug, g.id))
  )
    errors.slug = t("admin.msg.slugTaken");

  const client = await planClientChange(env, g, f, t, expiresAt);
  if (client.error) errors.clientId = client.error;

  if (Object.keys(errors).length)
    return fail(intent, t("admin.msg.checkFields"), errors);

  try {
    await getDb(env)
      .update(schema.galleries)
      .set({
        title,
        slug,
        clientName: clientRaw || null,
        eventDate: eventDate || null,
        expiresAt,
        // An expired gallery stops qualifying: the opt-in does not survive.
        ...client.set,
        ...(isExpired(expiresAt, Date.now()) ? { showOnHome: false } : {}),
      })
      .where(eq(schema.galleries.id, g.id));
  } catch (err) {
    if (isConstraintError(err))
      return fail(intent, t("admin.msg.checkFields"), {
        slug: t("admin.msg.slugTaken"),
      });
    throw err;
  }
  const vanished =
    client.assignId && !(await isAssignedTo(env, g.id, client.assignId));
  return done(
    intent,
    [
      t("admin.msg.detailsSaved"),
      vanished ? t("admin.msg.clientUnknown") : client.note,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/** drizzle wraps driver errors ("Failed query"); the SQLite text is in err.cause. */
export function isConstraintError(err: unknown): boolean {
  for (let e = err, i = 0; e != null && i < 8; i++) {
    const m = String(e instanceof Error ? e.message : e);
    if (/UNIQUE|SQLITE_CONSTRAINT/i.test(m)) return true;
    e = e instanceof Error ? e.cause : undefined;
  }
  return false;
}

/** True when another gallery or any client already uses `slug` (one namespace). */
export function slugTaken(env: Env, slug: string, selfId: string) {
  return slugInUse(env, slug, { galleryId: selfId });
}
