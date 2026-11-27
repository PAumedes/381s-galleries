import type { MessageKey, TFunction } from "../i18n/t";
import type { HelpItem } from "./help";
import { placeholderText, tokenizeHelp } from "./help-text";
import { PIN_MAX, PIN_MIN } from "./pin-rules";
import { SYNC_INTERVAL_MINUTES } from "./server/sync-types";

/**
 * The first-run wizard for the studio owner (T6.58): six short steps. The
 * words live in `app/i18n/{es,en}.wizard.ts` under `admin.wizard.<id>.*`.
 *
 * Like the help (lib/help.ts), button and tab names are never typed into the
 * texts: a text says `{publish}` and the step declares which dictionary key
 * that is, so a rename shows the new name and numbers come from the same
 * constants the server uses.
 */
export const WIZARD_PATH = "/admin/empezar";
export const WIZARD_PARAM = "paso";

export type WizardStepId =
  "drive" | "folders" | "client" | "gallery" | "settings" | "share";

export interface WizardLine {
  /** Help question (id of lib/help.ts) that explains this line in depth. */
  help?: string;
}

export interface WizardStep extends Pick<HelpItem, "labels" | "values"> {
  id: WizardStepId;
  /** Short lines under the lead (`l1`..`lN`). */
  lines: readonly WizardLine[];
  /** Help questions linked at the bottom of the step. */
  help: readonly string[];
}

/** done / todo = real state; optional = may be skipped; read = only to read. */
export type StepState = "done" | "todo" | "optional" | "read";

const SETTINGS = "admin.nav.settings";
const DETAILS = "admin.tabs.details";

export const WIZARD_STEPS: readonly WizardStep[] = [
  {
    id: "drive",
    lines: [{}, {}, {}],
    help: ["drive-connect", "drive-root"],
    labels: {
      connect: "admin.setup.connect",
      settings: SETTINGS,
      rootLabel: "admin.setup.root.label",
      rootSave: "admin.setup.root.save",
    },
  },
  {
    id: "folders",
    lines: [{}, {}, {}, {}],
    help: ["drive-folders", "drive-captureone"],
  },
  {
    id: "client",
    lines: [{}, {}],
    help: ["clients-create", "clients-assign"],
    labels: { details: DETAILS, clientFolder: "admin.edit.field.clientFolder" },
  },
  {
    id: "gallery",
    lines: [{}, {}, {}],
    help: ["albums-create", "updates-when"],
    labels: { syncNow: "admin.setup.sync.now", draft: "admin.state.draft" },
    values: { syncMinutes: SYNC_INTERVAL_MINUTES },
  },
  {
    id: "settings",
    lines: [
      { help: "albums-publish" },
      { help: "access-pin-album" },
      { help: "proof-modes" },
      { help: "proof-sizes" },
      { help: "albums-expiry" },
    ],
    help: [],
    labels: {
      details: DETAILS,
      publish: "admin.edit.action.publish",
      proofing: "admin.mode.proofing",
      delivery: "admin.mode.delivery",
      options: "admin.edit.section.options",
      expiresDate: "admin.edit.field.expiresDate",
    },
    values: { pinMin: PIN_MIN, pinMax: PIN_MAX },
  },
  {
    id: "share",
    lines: [{}, {}, {}],
    help: ["albums-share", "clients-page"],
    labels: { share: "admin.tabs.share" },
  },
];

export const WIZARD_STEP_COUNT = WIZARD_STEPS.length;

/** What the server knows; every step's state is a function of it. */
export interface WizardFacts {
  /** Connected (or demo mode) and a Drive folder chosen. */
  driveReady: boolean;
  clients: number;
  /** Not archived. */
  galleries: number;
  published: number;
}

export function wizardStates(f: WizardFacts): StepState[] {
  return [
    f.driveReady ? "done" : "todo",
    "read",
    f.clients > 0 ? "done" : "optional",
    f.galleries > 0 ? "done" : "todo",
    f.published > 0 ? "done" : "todo",
    "read",
  ];
}

/** 1-based number of the step to open when none is asked for: the first one still to do. */
export function firstOpenStep(states: readonly StepState[]): number {
  const i = states.findIndex((s) => s === "todo");
  return i === -1 ? states.length : i + 1;
}

export const wizardStepHref = (n: number) =>
  `${WIZARD_PATH}?${WIZARD_PARAM}=${n}`;

/** The step number of `?paso=`: one canonical digit 1..6, else null. */
export function parseWizardStep(raw: string | null): number | null {
  if (raw === null || !/^[1-9]$/.test(raw)) return null;
  const n = Number(raw);
  return n <= WIZARD_STEP_COUNT ? n : null;
}

/** Dictionary keys of one step: title, lead, lines. */
export function wizardStepKeys(step: Pick<WizardStep, "id" | "lines">) {
  const key = (part: string) => `admin.wizard.${step.id}.${part}` as MessageKey;
  return {
    title: key("title"),
    lead: key("a"),
    lines: step.lines.map((_, i) => key(`l${i + 1}`)),
  };
}

/** Keys of the page around the steps (frame, buttons, states, banner, entry points). */
export const WIZARD_PAGE_KEYS = [
  "admin.nav.wizard",
  "admin.meta.wizard",
  "admin.wizard.title",
  "admin.wizard.intro",
  "admin.wizard.steps",
  "admin.wizard.progress",
  "admin.wizard.state.done",
  "admin.wizard.state.todo",
  "admin.wizard.state.optional",
  "admin.wizard.state.read",
  "admin.wizard.back",
  "admin.wizard.next",
  "admin.wizard.skip",
  "admin.wizard.finish",
  "admin.wizard.goStep",
  "admin.wizard.moreHelp",
  "admin.wizard.helpLink",
  "admin.wizard.banner.title",
  "admin.wizard.banner.text",
  "admin.wizard.banner.open",
  "admin.wizard.banner.dismiss",
  "admin.wizard.drive.connected",
  "admin.wizard.drive.notConnected",
  "admin.wizard.drive.root",
  "admin.wizard.drive.noRoot",
  "admin.wizard.drive.openSettings",
  "admin.wizard.client.hint",
  "admin.wizard.client.none",
  "admin.wizard.client.some.one",
  "admin.wizard.client.some.other",
  "admin.wizard.gallery.none",
  "admin.wizard.gallery.some.one",
  "admin.wizard.gallery.some.other",
  "admin.wizard.gallery.more",
  "admin.wizard.gallery.needDrive",
  "admin.wizard.settings.noGallery",
  "admin.wizard.settings.for",
  "admin.wizard.settings.open",
  "admin.wizard.settings.now",
  "admin.wizard.val.pinOn",
  "admin.wizard.val.pinOff",
  "admin.wizard.val.dlOn",
  "admin.wizard.val.dlOff",
  "admin.wizard.val.expiryNone",
  "admin.wizard.val.expiryAt",
  "admin.wizard.share.noGallery",
  "admin.wizard.share.draft",
  "admin.wizard.share.linkLabel",
  "admin.wizard.share.clientLinkLabel",
] as const satisfies readonly MessageKey[];

/** A step text with every {placeholder} filled: button names between « », numbers as digits. */
export function resolveWizardText(
  step: Pick<WizardStep, "labels" | "values">,
  raw: string,
  t: TFunction,
): string {
  return tokenizeHelp(raw)
    .map((tok) =>
      tok.kind === "placeholder"
        ? placeholderText(step, tok.name, t)
        : tok.text,
    )
    .join("");
}
