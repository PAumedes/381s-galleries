import { desc, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { requestT } from "../../i18n/dictionaries";
import { galleryPath } from "../gallery-path";
import {
  firstOpenStep,
  parseWizardStep,
  WIZARD_PARAM,
  wizardStates,
  wizardStepHref,
  type StepState,
} from "../wizard";
import { adminAction } from "./admin";
import type { ClientActionResult } from "./admin-clients/errors";
import { fail, str } from "./admin-galleries/actions/shared";
import { createWizardClient } from "./admin-wizard/create-client";
import { dismissWizard, wizardDismissed } from "./admin-wizard/dismiss";
import { requireAdmin } from "./auth";
import { isGoogleConnected } from "./google-auth";
import { publicOrigin, publicGalleryUrl } from "./public-url";
import { getSetting, SETTINGS_KEYS } from "./settings";

export { wizardDismissed } from "./admin-wizard/dismiss";

/** Detected galleries named in step 4. */
const RECENT_MAX = 5;

/**
 * D1 queries the wizard page makes: Google token, folder name, one for the
 * three counts, one for the newest galleries (the first is also the gallery
 * that steps 5 and 6 talk about).
 */
export const WIZARD_D1_QUERIES = 4;
/** Extra D1 queries the admin home spends on the banner: the "dismissed" setting, only when the banner could show. */
export const WIZARD_BANNER_D1_QUERIES = 1;

export interface WizardTarget {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  mode: "delivery" | "proofing";
  /** Whether a PIN is set; the hash never leaves the server. */
  pin: boolean;
  /** Whether any download size is allowed. */
  downloads: boolean;
  expiresAt: string | null;
  url: string;
  clientName: string | null;
  /** The client page, only when the album has a client whose page is on. */
  clientUrl: string | null;
}

export interface WizardData {
  /** 1-based step to show. */
  step: number;
  states: StepState[];
  mock: boolean;
  connected: boolean;
  /** Connected (or demo) and a folder chosen. */
  driveReady: boolean;
  rootName: string | null;
  clients: number;
  galleries: {
    count: number;
    published: number;
    recent: {
      id: string;
      title: string;
      status: "draft" | "published" | "archived";
    }[];
  };
  target: WizardTarget | null;
}

/** Not archived: archived albums are gone from the owner's point of view. */
const notArchived = ne(schema.galleries.status, "archived");

async function counts(env: Env) {
  const g = schema.galleries;
  const [row] = await getDb(env)
    .select({
      clients: sql<number>`(SELECT count(*) FROM ${schema.clients})`,
      galleries: sql<number>`count(*)`,
      published: sql<number>`coalesce(sum(${g.status} = 'published'), 0)`,
    })
    .from(g)
    .where(notArchived);
  return row!;
}

async function newest(env: Env) {
  const g = schema.galleries;
  const c = schema.clients;
  return getDb(env)
    .select({
      id: g.id,
      title: g.title,
      slug: g.slug,
      status: g.status,
      mode: g.mode,
      pin: sql<number>`${g.pinHash} IS NOT NULL`,
      downloads: sql<number>`(${g.allowHighres} OR ${g.allowWeb} OR ${g.allowIg} OR ${g.allowBulk})`,
      expiresAt: g.expiresAt,
      clientName: c.name,
      clientSlug: c.slug,
      pageEnabled: c.pageEnabled,
    })
    .from(g)
    .leftJoin(c, eq(c.id, g.clientId))
    .where(notArchived)
    .orderBy(desc(g.createdAt), desc(g.id))
    .limit(RECENT_MAX);
}

/** `/admin/empezar` loader: admin login, then the real state of every step. */
export async function wizardData(
  request: Request,
  env: Env,
): Promise<WizardData> {
  await requireAdmin(request, env);
  return loadWizard(request, env);
}

/** The state of the wizard, without the login check (the caller did it). */
export async function loadWizard(
  request: Request,
  env: Env,
): Promise<WizardData> {
  const mock = env.DRIVE_MODE === "mock";
  const connected = await isGoogleConnected(env);
  const rootName = (await getSetting(env, SETTINGS_KEYS.driveRootName)) ?? null;
  const n = await counts(env);
  const rows = await newest(env);
  const driveReady = mock || (connected && rootName !== null);
  const states = wizardStates({
    driveReady,
    clients: n.clients,
    galleries: n.galleries,
    published: n.published,
  });
  const first = rows[0];
  const step =
    parseWizardStep(new URL(request.url).searchParams.get(WIZARD_PARAM)) ??
    firstOpenStep(states);
  return {
    step,
    states,
    mock,
    connected,
    driveReady,
    rootName,
    clients: n.clients,
    galleries: {
      count: n.galleries,
      published: n.published,
      recent: rows.map(({ id, title, status }) => ({ id, title, status })),
    },
    target: first
      ? {
          id: first.id,
          title: first.title,
          status: first.status,
          mode: first.mode,
          pin: !!first.pin,
          downloads: !!first.downloads,
          expiresAt: first.expiresAt,
          url: publicGalleryUrl(env, request, first.slug, first.clientSlug),
          clientName: first.clientName,
          clientUrl:
            first.clientSlug && first.pageEnabled
              ? `${publicOrigin(env, request)}${galleryPath(first.clientSlug)}`
              : null,
        }
      : null,
  };
}

/**
 * Whether the admin home shows the "first steps" banner: no gallery yet or
 * Drive not connected, and the owner did not dismiss it. The dismissal is read
 * only when the banner could show, so a working studio pays no extra query.
 */
export async function wizardBannerVisible(
  env: Env,
  state: { connected: boolean; galleries: number },
): Promise<boolean> {
  const ready = env.DRIVE_MODE === "mock" || state.connected;
  if (ready && state.galleries > 0) return false;
  return !(await wizardDismissed(env));
}

export type WizardActionResult = ClientActionResult;

/** POST /admin/empezar: createClient | dismiss. */
export async function wizardAction(
  request: Request,
  env: Env,
): Promise<WizardActionResult> {
  await adminAction(request, env);
  const t = requestT(request);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("", t("admin.msg.invalidRequest"));
  }
  const intent = str(form, "intent");
  switch (intent) {
    case "createClient":
      return createWizardClient(env, form, t, wizardStepHref(4));
    case "dismiss":
      return dismissWizard(env, "/admin");
    default:
      return fail(intent, t("admin.msg.unknownAction"));
  }
}
