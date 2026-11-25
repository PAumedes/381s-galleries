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
export { SLUG_MAX };

function titleError(title: string, t: TFunction) {
  return title.length < 1 || title.length > TITLE_MAX || CONTROL_RE.test(title)
    ? t("admin.msg.titleLength", { max: TITLE_MAX })
    : undefined;
}

function slugFormatError(slug: string, t: TFunction) {
  if (RESERVED_SLUGS.includes(slug)) return t("admin.msg.slugReserved");
  return !slug || slug.length > SLUG_MAX || !SLUG_RE.test(slug)
    ? t("admin.msg.slugFormat", { max: SLUG_MAX })
    : undefined;
}

/** The expiry from the date/time inputs (UTC ISO or null) and the error to show, if any. */
function parseExpiry(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
): { expiresAt: string | null; error?: string } {
  const expDate = str(f, "expiresDate").trim();
  const expTime = str(f, "expiresTime").trim();
  if (!expDate && !expTime) return { expiresAt: null };
  const yr = Number(expDate.slice(0, 4));
  if (expDate && (yr < EXPIRY_YEAR_MIN || yr > EXPIRY_YEAR_MAX))
    return {
      expiresAt: null,
      error: t("admin.msg.expiryYear", {
        min: EXPIRY_YEAR_MIN,
        max: EXPIRY_YEAR_MAX,
      }),
    };
  // A date without a time means "until the end of that day" (studio time).
  const expiresAt = expDate
    ? resolveExpiry(
        expDate,
        expTime || "23:59",
        g.expiresAt,
        validTimezone(env.TIMEZONE),
      )
    : null;
  if (expiresAt) return { expiresAt };
  return {
    expiresAt,
    error: expDate
      ? t("admin.msg.expiryInvalid")
      : t("admin.msg.expiryNeedsDate"),
  };
}

/** Saves the details; false when the slug unique constraint lost a race. */
async function writeDetails(
  env: Env,
  g: GalleryRow,
  clientSet: object,
  v: {
    title: string;
    slug: string;
    eventDate: string | null;
    expiresAt: string | null;
  },
): Promise<boolean> {
  try {
    await getDb(env)
      .update(schema.galleries)
      .set({
        ...v,
        // An expired gallery stops qualifying: the opt-in does not survive.
        ...clientSet,
        ...(isExpired(v.expiresAt, Date.now()) ? { showOnHome: false } : {}),
      })
      .where(eq(schema.galleries.id, g.id));
    return true;
  } catch (err) {
    if (isConstraintError(err)) return false;
    throw err;
  }
}

export async function saveDetails(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
) {
  const intent = "details";
  const errors: Record<string, string> = {};

  const title = str(f, "title").trim();
  const tErr = titleError(title, t);
  if (tErr) errors.title = tErr;

  const slug = str(f, "slug").trim().toLowerCase();
  const sErr = slugFormatError(slug, t);
  if (sErr) errors.slug = sErr;

  const eventDate = str(f, "eventDate").trim();
  if (eventDate && !isValidDate(eventDate))
    errors.eventDate = t("admin.msg.eventDateInvalid");

  const { expiresAt, error: expiryError } = parseExpiry(env, g, f, t);
  if (expiryError) errors.expires = expiryError;

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

  if (
    !(await writeDetails(env, g, client.set, {
      title,
      slug,
      eventDate: eventDate || null,
      expiresAt,
    }))
  )
    return fail(intent, t("admin.msg.checkFields"), {
      slug: t("admin.msg.slugTaken"),
    });
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
