import type { MessageKey } from "../i18n/t";
import { PIN_MAX, PIN_MIN } from "./pin-rules";

/**
 * The help for the studio owner (T6.57): which sections and questions exist.
 * The words live in `app/i18n/{es,en}.help.ts` under `admin.help.<id>.*`.
 *
 * Button and tab names are never typed into the texts: a text says `{publish}`
 * and the item declares `publish: "admin.edit.action.publish"`, so the help
 * always shows the real name in the real language, and renaming a key breaks
 * the build. Numbers that the server also uses come from the same definition.
 */
export interface HelpItem {
  /** Anchor and dictionary prefix: globally unique, kebab-case. */
  id: string;
  /** Number of steps (`s1`..`sN`); at most 6. */
  steps?: number;
  /** With steps: also an introduction (`a`). Without steps the answer is always there. */
  lead?: boolean;
  /** Show the list as bullets instead of numbered steps. */
  bullets?: boolean;
  /** `{name}` placeholders that show a UI label. */
  labels?: Readonly<Record<string, MessageKey>>;
  /** `{name}` placeholders that show a fixed value. */
  values?: Readonly<Record<string, string | number>>;
}

export interface HelpSection {
  id: string;
  items: readonly HelpItem[];
}

const item = (
  id: string,
  labels?: HelpItem["labels"],
  more: Omit<HelpItem, "id" | "labels"> = {},
): HelpItem => ({ id, ...(labels ? { labels } : {}), ...more });

// Labels used by several items.
const SETTINGS = "admin.nav.settings";
const SYNC_NOW = "admin.setup.sync.now";
const DETAILS = "admin.tabs.details";
const PHOTOS = "admin.tabs.photos";
const SHARE = "admin.tabs.share";
const COVER = "admin.tabs.cover";
const OPTIONS = "admin.edit.section.options";
const SAVE_OPTIONS = "admin.edit.opt.save";
const PROOFING = "admin.mode.proofing";
const DELIVERY = "admin.mode.delivery";
const PUBLISH = "admin.edit.action.publish";
const DRAFT = "admin.state.draft";
const FAVORITES = "admin.tabs.favorites";
const ACTIVITY = "admin.tabs.activity";
const CLIENTS = "admin.nav.clients";
const HOME_LABEL = "admin.edit.home.label";
const UNAVAILABLE = "unavailable.title";
const SAVE_DETAILS = "admin.edit.saveDetails";

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: "start",
    items: [
      item("start-what"),
      item(
        "start-overview",
        {
          settings: SETTINGS,
          syncNow: SYNC_NOW,
          publish: PUBLISH,
          share: SHARE,
        },
        { steps: 6 },
      ),
      item("start-who-sees"),
      item("start-language"),
      item(
        "start-brand",
        {
          settings: SETTINGS,
          brandName: "admin.setup.brand.name",
          saveName: "admin.setup.brand.save",
          upload: "admin.setup.logo.upload",
        },
        { steps: 3, lead: true },
      ),
    ],
  },
  {
    id: "drive",
    items: [
      item(
        "drive-connect",
        {
          settings: SETTINGS,
          connect: "admin.setup.connect",
          connected: "admin.status.connected",
        },
        { steps: 4, lead: true },
      ),
      item("drive-readonly"),
      item(
        "drive-root",
        {
          settings: SETTINGS,
          rootLabel: "admin.setup.root.label",
          rootSave: "admin.setup.root.save",
        },
        { steps: 4, lead: true },
      ),
      item("drive-root-change", { archived: "admin.filter.archivadas" }),
      item("drive-folders", undefined, { steps: 6, lead: true, bullets: true }),
      item("drive-names"),
      item("drive-captureone", undefined, { steps: 5 }),
      item("drive-sets"),
      item("updates-when", {
        syncNow: SYNC_NOW,
        draft: DRAFT,
        settings: SETTINGS,
      }),
      item("updates-issues", {
        issues: "admin.edit.section.issues",
        photos: PHOTOS,
      }),
    ],
  },
  {
    id: "albums",
    items: [
      item("albums-create", { draft: DRAFT }),
      item(
        "albums-publish",
        {
          galleries: "admin.nav.galleries",
          preview: "admin.edit.preview",
          details: DETAILS,
          status: "admin.edit.section.status",
          publish: PUBLISH,
          share: SHARE,
        },
        { steps: 4 },
      ),
      item("albums-hide", {
        toDraft: "admin.edit.action.draft",
        archive: "admin.edit.action.archive",
        restore: "admin.edit.action.restore",
        published: "admin.state.published",
      }),
      item(
        "albums-details",
        {
          details: DETAILS,
          title: "admin.edit.field.title",
          eventDate: "admin.edit.field.eventDate",
          addressField: "admin.edit.field.slug",
          save: SAVE_DETAILS,
        },
        { steps: 3, lead: true },
      ),
      item(
        "albums-expiry",
        {
          details: DETAILS,
          expiresDate: "admin.edit.field.expiresDate",
          expiresTime: "admin.edit.field.expiresTime",
          save: SAVE_DETAILS,
          unavailable: UNAVAILABLE,
        },
        { steps: 4, lead: true },
      ),
      item(
        "albums-home",
        {
          details: DETAILS,
          homeSection: "admin.edit.section.home",
          homeLabel: HOME_LABEL,
          homeSave: "admin.edit.home.save",
        },
        { steps: 3, lead: true },
      ),
      item(
        "albums-share",
        {
          share: SHARE,
          copy: "admin.share.copy",
          whatsapp: "admin.share.whatsapp",
          qrSvg: "admin.share.qrSvg",
          qrPng: "admin.share.qrPng",
          card: "admin.share.card",
        },
        { steps: 5, lead: true },
      ),
      item(
        "albums-design",
        {
          design: "admin.tabs.design",
          palette: "admin.design.palette",
          coverLayout: "admin.design.coverLayout",
          grid: "admin.design.gridStyle",
          gap: "admin.design.gridGap",
          saveDesign: "admin.edit.saveDesign",
        },
        { steps: 4 },
      ),
      item(
        "albums-delete",
        {
          details: DETAILS,
          danger: "admin.edit.section.danger",
          deleteButton: "admin.edit.delete.button",
          settings: SETTINGS,
          ignored: "admin.setup.section.ignored",
          reinclude: "admin.setup.ignored.reinclude",
        },
        { steps: 5, lead: true },
      ),
      item(
        "photos-order",
        {
          photos: PHOTOS,
          sortDate: "admin.reorder.sortDate",
          sortName: "admin.reorder.sortName",
          saveOrder: "admin.reorder.save",
        },
        { steps: 4 },
      ),
      item(
        "photos-cover",
        { photos: PHOTOS, useCover: "admin.reorder.useAsCover" },
        { steps: 3, lead: true },
      ),
      item(
        "photos-focal",
        { cover: COVER, saveFocal: "admin.cover.save" },
        { steps: 4, lead: true },
      ),
      item("photos-mobile-cover", {
        cover: COVER,
        mobileCover: "admin.cover.deviceMobile",
        chooseMobile: "admin.cover.chooseMobile",
      }),
    ],
  },
  {
    id: "access",
    items: [
      item(
        "access-pin-album",
        {
          details: DETAILS,
          pinSection: "admin.edit.section.pin",
          pinNew: "admin.edit.pin.new",
          pinSave: "admin.edit.pin.save",
          pinChange: "admin.edit.pin.change",
        },
        {
          steps: 3,
          lead: true,
          // The length shown is the one the server enforces.
          values: { pinMin: PIN_MIN, pinMax: PIN_MAX },
        },
      ),
      item("access-pin-change", { pinRemove: "admin.edit.pin.remove" }),
      item(
        "access-pin-client",
        {
          clients: CLIENTS,
          clientPin: "admin.clients.section.pin",
          pinSave: "admin.clients.pin.save",
        },
        { steps: 3, lead: true },
      ),
      item("access-email", {
        options: OPTIONS,
        requireEmail: "admin.edit.opt.requireEmail",
        saveOptions: SAVE_OPTIONS,
        activity: ACTIVITY,
        favorites: FAVORITES,
      }),
    ],
  },
  {
    id: "proof",
    items: [
      item(
        "proof-modes",
        { delivery: DELIVERY, proofing: PROOFING },
        { steps: 2, bullets: true },
      ),
      item(
        "proof-setup",
        { options: OPTIONS, proofing: PROOFING, saveOptions: SAVE_OPTIONS },
        { steps: 4, lead: true },
      ),
      item(
        "proof-sizes",
        {
          options: OPTIONS,
          saveOptions: SAVE_OPTIONS,
          bulk: "admin.edit.opt.bulk",
          highres: "admin.edit.opt.highres",
          web: "admin.edit.opt.web",
          ig: "admin.edit.opt.ig",
        },
        { steps: 3, lead: true, bullets: true },
      ),
      item("proof-favorites", { favorites: FAVORITES }),
      item(
        "proof-favorites-see",
        {
          favorites: FAVORITES,
          copyCapture: "admin.favorites.copyCapture",
          downloadTxt: "admin.favorites.downloadTxt",
        },
        { steps: 4 },
      ),
      item("proof-activity", {
        activity: ACTIVITY,
        exportCsv: "admin.activity.exportCsv",
        views: "admin.list.col.views",
        downloads: "admin.list.col.downloads",
        galleries: "admin.nav.galleries",
      }),
    ],
  },
  {
    id: "clients",
    items: [
      item(
        "clients-create",
        {
          clients: CLIENTS,
          name: "admin.clients.field.name",
          create: "admin.clients.create.button",
        },
        { steps: 3, lead: true },
      ),
      item(
        "clients-assign",
        {
          details: DETAILS,
          clientFolder: "admin.edit.field.clientFolder",
          save: SAVE_DETAILS,
        },
        { steps: 3, lead: true },
      ),
      item("clients-page", {
        pageEnabled: "admin.clients.field.pageEnabled",
        saveClient: "admin.clients.save",
      }),
      item("clients-defaults", {
        delivery: DELIVERY,
        proofing: PROOFING,
        applyAll: "admin.clients.apply.button",
      }),
      item(
        "clients-delete",
        {
          clients: CLIENTS,
          dangerClient: "admin.clients.section.danger",
          deleteClient: "admin.clients.delete.button",
        },
        { steps: 4, lead: true },
      ),
    ],
  },
  {
    id: "versions",
    items: [
      item("versions-what"),
      item(
        "versions-on",
        {
          details: DETAILS,
          versionsSection: "admin.edit.section.versions",
          versionsLabel: "admin.edit.versions.label",
          versionsSave: "admin.edit.versions.save",
          syncNow: SYNC_NOW,
          settings: SETTINGS,
        },
        { steps: 4, lead: true },
      ),
      item("versions-names"),
      item("versions-rounds", { newInRound: "grid.newInRound" }),
      item("versions-compare", {
        flip: "compare.flip",
        slide: "compare.slide",
      }),
      item("versions-approvals", {
        approvals: "admin.edit.section.approvals",
        photos: PHOTOS,
      }),
      item("versions-tiff"),
      item("versions-tiff-client", {
        tiffCard: "preview.tiff",
        tiffDownload: "preview.download",
        tiffDelivery: "client.tiffDelivery",
      }),
    ],
  },
  {
    id: "trouble",
    items: [
      item("trouble-photo-missing", {
        syncNow: SYNC_NOW,
        issues: "admin.edit.section.issues",
      }),
      item("trouble-order", {
        photos: PHOTOS,
        saveOrder: "admin.reorder.save",
      }),
      item("trouble-old-photo"),
      item("trouble-blank-proof", { proofing: PROOFING }),
      item("trouble-pin"),
      item(
        "trouble-download",
        {
          proofing: PROOFING,
          delivery: DELIVERY,
          options: OPTIONS,
          saveOptions: SAVE_OPTIONS,
        },
        { steps: 5, bullets: true },
      ),
      item("trouble-link", { unavailable: UNAVAILABLE, share: SHARE }),
      item("trouble-back-button"),
      item("trouble-sync-error", {
        syncNow: SYNC_NOW,
        settings: SETTINGS,
        reconnect: "admin.setup.reconnect",
      }),
      item("trouble-home", {
        homeLabel: HOME_LABEL,
        details: DETAILS,
        proofing: PROOFING,
      }),
    ],
  },
];

/** Keys of the page around the questions (title, search box, links). */
export const HELP_PAGE_KEYS = [
  "admin.help.title",
  "admin.help.intro",
  "admin.help.toc",
  "admin.help.search.label",
  "admin.help.search.placeholder",
  "admin.help.search.submit",
  "admin.help.search.count.one",
  "admin.help.search.count.other",
  "admin.help.search.none",
  "admin.help.link",
  "admin.nav.help",
  "admin.meta.help",
] as const satisfies readonly MessageKey[];

export const helpSectionKey = (sectionId: string) =>
  `admin.help.section.${sectionId}` as MessageKey;

/** Dictionary keys of one item: question, optional answer/lead, steps. */
export function helpItemKeys(item: HelpItem): {
  q: MessageKey;
  a?: MessageKey;
  steps: MessageKey[];
} {
  const key = (part: string) => `admin.help.${item.id}.${part}` as MessageKey;
  const count = item.steps ?? 0;
  return {
    q: key("q"),
    ...(count === 0 || item.lead ? { a: key("a") } : {}),
    steps: Array.from({ length: count }, (_, i) => key(`s${i + 1}`)),
  };
}
