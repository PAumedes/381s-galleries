import { describe, expect, it } from "vitest";
import { en } from "../app/i18n/en";
import { enHelp } from "../app/i18n/en.help";
import { es } from "../app/i18n/es";
import { esHelp } from "../app/i18n/es.help";
import { makeT } from "../app/i18n/t";
import {
  HELP_PAGE_KEYS,
  HELP_SECTIONS,
  helpItemKeys,
  helpSectionKey,
  type HelpItem,
} from "../app/lib/help";
import { resolveHelpItem } from "../app/lib/help-text";
import { PIN_MAX, PIN_MAX_ATTEMPTS, PIN_MIN } from "../app/lib/pin-rules";
import { DL_TOKEN_TTL_SECONDS } from "../app/lib/server/download-shared";
import { LOGO_MAX_BYTES } from "../app/lib/server/logo-types";
import { SYNC_DELETE_GRACE_MS } from "../app/lib/server/sync-types";

// T6.57: the in-app help for the studio owner (not a developer).

const LANGS = [
  ["es", es, esHelp],
  ["en", en, enHelp],
] as const;

const items: { section: string; item: HelpItem }[] = HELP_SECTIONS.flatMap(
  (s) => s.items.map((item) => ({ section: s.id, item })),
);

/** Words the owner must never meet (labels come in through placeholders, so a button called "Sync now" is fine). */
const FORBIDDEN = [
  "d1",
  "r2",
  "sync",
  "token",
  "tokens",
  "epoch",
  "mirror",
  "espejo",
  "cron",
  "api",
  "json",
  "oauth",
  "hmac",
  "worker",
  "cache",
  "caché",
  "cookie",
  "cookies",
  "hash",
  "slug",
  "endpoint",
  "jwt",
  "pbkdf2",
  "backend",
  "frontend",
  "database",
  "base de datos",
  "deploy",
  "query",
  "payload",
  // The app says "vence", never these.
  "caducar",
  "caduca",
  "caducidad",
  "expira",
  "expirar",
  "metadatos",
  "metadata",
  "bucket",
  "dns",
  "ssl",
  "html",
  "css",
];
const forbiddenRe = (w: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${w}($|[^\\p{L}\\p{N}])`, "iu");

const sentences = (s: string) =>
  s.split(/[.!?]+(?:\s+|$)/).filter((x) => x.trim()).length;

/** Texts of an item as written in a dictionary (placeholders and code spans untouched). */
function rawTexts(lang: "es" | "en", item: HelpItem) {
  const dict = lang === "es" ? esHelp : enHelp;
  const k = helpItemKeys(item);
  const get = (key: string) => (dict as Record<string, string>)[key];
  return {
    q: get(k.q),
    a: k.a ? get(k.a) : undefined,
    steps: k.steps.map(get),
  };
}

describe("T6.57 help: structure", () => {
  it("has a handful of sections and 40-70 questions", () => {
    expect(HELP_SECTIONS.length).toBeGreaterThanOrEqual(5);
    expect(HELP_SECTIONS.length).toBeLessThanOrEqual(10);
    expect(items.length).toBeGreaterThanOrEqual(40);
    expect(items.length).toBeLessThanOrEqual(70);
    for (const s of HELP_SECTIONS) expect(s.items.length).toBeGreaterThan(0);
  });

  it("anchors are unique, lowercase kebab-case, shared by sections and items", () => {
    const ids = [
      ...HELP_SECTIONS.map((s) => s.id),
      ...items.map((i) => i.item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  });

  it("every item has an answer or steps, at most 6 steps", () => {
    for (const { item } of items) {
      const steps = item.steps ?? 0;
      expect(steps).toBeLessThanOrEqual(6);
      const hasAnswer = helpItemKeys(item).a !== undefined;
      expect(hasAnswer || steps > 0, item.id).toBe(true);
      if (steps > 0 && item.lead !== true)
        expect(hasAnswer, `${item.id} has steps and no lead`).toBe(false);
    }
  });
});

describe.each(LANGS)("T6.57 help: dictionary (%s)", (lang, all, help) => {
  it("has every key of every item and section, non-empty, and no orphans", () => {
    const expected = new Set<string>(HELP_PAGE_KEYS);
    for (const s of HELP_SECTIONS) expected.add(helpSectionKey(s.id));
    for (const { item } of items) {
      const k = helpItemKeys(item);
      expected.add(k.q);
      expected.add(k.k);
      if (k.a) expected.add(k.a);
      k.steps.forEach((x) => expected.add(x));
    }
    const have = Object.keys(help);
    for (const key of expected) {
      const v = (help as Record<string, string>)[key];
      expect(typeof v, `${lang} ${key}`).toBe("string");
      expect(v.trim().length, `${lang} ${key}`).toBeGreaterThan(0);
    }
    const orphans = have.filter((k) => !expected.has(k as never));
    expect(orphans).toEqual([]);
  });

  it("is merged into the full dictionary (admin keys only)", () => {
    for (const [k, v] of Object.entries(help))
      expect((all as Record<string, string>)[k]).toBe(v);
    for (const k of Object.keys(help))
      expect(k.startsWith("admin.")).toBe(true);
  });
});

describe("T6.57 help: es and en say the same thing", () => {
  it("same keys in both languages, and the texts are not copies", () => {
    expect(Object.keys(enHelp).sort()).toEqual(Object.keys(esHelp).sort());
    const same = Object.keys(esHelp).filter(
      (k) =>
        (esHelp as Record<string, string>)[k] ===
          (enHelp as Record<string, string>)[k] &&
        /[a-z]{4,}/i.test((esHelp as Record<string, string>)[k]),
    );
    expect(same).toEqual([]);
  });

  it("each text uses the same placeholders in both languages", () => {
    const ph = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(esHelp))
      expect(ph((enHelp as Record<string, string>)[k]), k).toEqual(
        ph((esHelp as Record<string, string>)[k]),
      );
  });
});

describe.each(["es", "en"] as const)("T6.57 help: readable (%s)", (lang) => {
  it("questions are short; answers are 1-4 short sentences; steps are short", () => {
    for (const { item } of items) {
      const t = rawTexts(lang, item);
      const id = `${lang} ${item.id}`;
      expect(t.q.length, `${id} q`).toBeLessThanOrEqual(90);
      if (t.a !== undefined) {
        const max = t.steps.length > 0 ? 220 : 300;
        expect(t.a.length, `${id} a`).toBeLessThanOrEqual(max);
        expect(sentences(t.a), `${id} a`).toBeLessThanOrEqual(
          t.steps.length > 0 ? 3 : 4,
        );
        expect(sentences(t.a), `${id} a`).toBeGreaterThanOrEqual(1);
      }
      expect(t.steps.length, `${id} steps`).toBeLessThanOrEqual(6);
      for (const s of t.steps) {
        expect(s.length, `${id} step`).toBeLessThanOrEqual(150);
        expect(sentences(s), `${id} step`).toBeLessThanOrEqual(2);
      }
      for (const text of [t.q, t.a, ...t.steps])
        if (text !== undefined) {
          expect(text, id).not.toMatch(/\n/);
          expect(text, id).toBe(text.trim());
        }
    }
  });

  it("resolved text (labels filled in) stays within the length limits", () => {
    const t = makeT(lang, lang === "es" ? es : en);
    for (const { item } of items) {
      const r = resolveHelpItem(item, t);
      const total =
        r.q.length +
        (r.a?.length ?? 0) +
        r.steps.reduce((n, s) => n + s.length, 0);
      expect(total, `${lang} ${item.id}`).toBeLessThanOrEqual(760);
      if (r.a !== undefined) expect(r.a.length).toBeLessThanOrEqual(340);
      for (const s of r.steps) expect(s.length).toBeLessThanOrEqual(190);
    }
  });

  it("no jargon, no emoji, no quotes or markup outside placeholders and code spans", () => {
    for (const { item } of items) {
      const t = rawTexts(lang, item);
      for (const text of [t.q, t.a, ...t.steps]) {
        if (text === undefined) continue;
        const id = `${lang} ${item.id}: ${text}`;
        const plain = text.replace(/`[^`]*`/g, " ").replace(/\{\w+\}/g, " ");
        for (const w of FORBIDDEN)
          expect(plain, `${id} (${w})`).not.toMatch(forbiddenRe(w));
        expect(text, id).not.toMatch(/\p{Extended_Pictographic}/u);
        // Labels come only from placeholders: renaming a button then updates the help.
        expect(text, id).not.toMatch(/[«»"“”<>]/);
        expect((text.match(/`/g) ?? []).length % 2, id).toBe(0);
        expect(text, id).not.toMatch(/!{2,}|\?{2,}/);
      }
    }
  });
});

describe("T6.57 help: UI labels", () => {
  it("every placeholder is declared, every declaration is used (both languages)", () => {
    for (const { item } of items) {
      const declared = new Set([
        ...Object.keys(item.labels ?? {}),
        ...Object.keys(item.values ?? {}),
      ]);
      const used = new Set<string>();
      for (const lang of ["es", "en"] as const) {
        const t = rawTexts(lang, item);
        for (const text of [t.q, t.a, ...t.steps])
          for (const m of (text ?? "").matchAll(/\{(\w+)\}/g)) {
            used.add(m[1]);
            expect(declared.has(m[1]), `${item.id} {${m[1]}}`).toBe(true);
          }
      }
      for (const name of declared)
        expect(used.has(name), `${item.id} declares unused {${name}}`).toBe(
          true,
        );
    }
  });

  it("every label key exists in the es and en dictionaries with plain text (no variables)", () => {
    for (const { item } of items)
      for (const [name, key] of Object.entries(item.labels ?? {}))
        for (const dict of [es, en]) {
          const v = (dict as Record<string, string>)[key];
          expect(v, `${item.id} {${name}} -> ${key}`).toBeTruthy();
          expect(v, `${key}`).not.toMatch(/\{\w+\}/);
        }
  });

  it("resolved text shows the real button names, each in typographic quotes", () => {
    for (const lang of ["es", "en"] as const) {
      const dict = lang === "es" ? es : en;
      const t = makeT(lang, dict);
      for (const { item } of items) {
        const r = resolveHelpItem(item, t);
        const all = [r.q, r.a ?? "", ...r.steps].join("\n");
        expect(all, item.id).not.toMatch(/\{\w+\}/);
        for (const key of Object.values(item.labels ?? {}))
          expect(all, `${lang} ${item.id} ${key}`).toContain(
            `«${(dict as Record<string, string>)[key]}»`,
          );
      }
    }
  });

  it("PIN limits come from the one definition the server uses", () => {
    const item = items.find((i) => i.item.id === "access-pin-album")!.item;
    expect(item.values).toMatchObject({ pinMin: PIN_MIN, pinMax: PIN_MAX });
    const r = resolveHelpItem(item, makeT("es", es));
    expect([r.a, ...r.steps].join(" ")).toContain(`${PIN_MIN}`);
    expect([r.a, ...r.steps].join(" ")).toContain(`${PIN_MAX}`);
  });
});

describe("T6.57 help: covers every aspect", () => {
  // One anchor per topic the owner listed; if a topic is dropped this fails.
  const TOPICS = [
    "drive-connect",
    "drive-folders",
    "drive-captureone",
    "drive-sets",
    "drive-readonly",
    "updates-when",
    "albums-create",
    "albums-publish",
    "albums-hide",
    "albums-expiry",
    "albums-home",
    "albums-share",
    "albums-delete",
    "photos-cover",
    "photos-focal",
    "access-pin-album",
    "access-pin-change",
    "access-pin-client",
    "proof-modes",
    "proof-setup",
    "proof-sizes",
    "proof-favorites",
    "proof-activity",
    "clients-create",
    "clients-page",
    "clients-delete",
    "versions-on",
    "versions-names",
    "versions-compare",
    "versions-approvals",
    "versions-tiff",
    "trouble-photo-missing",
    "trouble-old-photo",
    "trouble-pin",
    "trouble-download",
    "trouble-link",
    "start-logout",
    "start-brand",
    "drive-rename",
    "drive-disconnect",
    "albums-reinclude",
    "albums-find",
    "photos-add",
    "photos-remove",
    "photos-view-as",
    "clients-rename",
    "trouble-client-page",
    "trouble-home",
  ];
  it("has the anchors for every topic", () => {
    const ids = new Set(items.map((i) => i.item.id));
    expect(TOPICS.filter((t) => !ids.has(t))).toEqual([]);
  });

  it("the troubleshooting section lists the usual problems", () => {
    const trouble = HELP_SECTIONS.find((s) => s.id === "trouble");
    expect(trouble?.items.length).toBeGreaterThanOrEqual(10);
  });
});

describe("T6.57 help: search words", () => {
  it.each(["es", "en"] as const)(
    "every question has hidden search words (%s), plain lowercase words",
    (lang) => {
      for (const { item } of items) {
        const k = (lang === "es" ? esHelp : enHelp)[
          helpItemKeys(item).k as keyof typeof esHelp
        ] as string;
        expect(k.trim().length, item.id).toBeGreaterThan(3);
        expect(k, item.id).toBe(k.toLowerCase());
        expect(k, item.id).not.toMatch(/[.,;:!?{}«»`"]/);
      }
    },
  );
});

describe("T6.57 help: wording", () => {
  const CLIENT_SCREENS = /^clients-/;
  it("says galería / gallery (the admin's word); album only on the clients screens", () => {
    for (const { item } of items) {
      if (CLIENT_SCREENS.test(item.id)) continue;
      for (const lang of ["es", "en"] as const) {
        const t = rawTexts(lang, item);
        for (const text of [t.q, t.a, ...t.steps])
          expect(text ?? "", `${lang} ${item.id}`).not.toMatch(
            lang === "es" ? /álbum/i : /\balbum/i,
          );
      }
    }
  });
  it("the page intro says once that a gallery is an album", () => {
    expect(esHelp["admin.help.intro"]).toContain("galería (álbum)");
    expect(enHelp["admin.help.intro"]).toContain("gallery (album)");
  });
  it("no number that the server defines is typed by hand: it is a value", () => {
    const need: Record<string, string[]> = {
      "start-brand": ["logoKb"],
      "drive-root-change": ["graceMinutes"],
      "photos-remove": ["graceMinutes"],
      "trouble-photo-missing": ["graceMinutes"],
      "trouble-pin": ["pinMaxAttempts"],
      "trouble-download": ["dlMinutes"],
      "access-pin-album": ["pinMin", "pinMax"],
    };
    for (const [id, names] of Object.entries(need)) {
      const item = items.find((i) => i.item.id === id)!.item;
      for (const n of names)
        expect(item.values, `${id} ${n}`).toHaveProperty(n);
      for (const lang of ["es", "en"] as const) {
        const t = rawTexts(lang, item);
        const all = [t.q, t.a ?? "", ...t.steps].join(" ");
        for (const n of names)
          expect(all, `${lang} ${id} {${n}}`).toContain(`{${n}}`);
        expect(all, `${lang} ${id}`).not.toMatch(
          /\b(512|60 min|5 (intentos|wrong))/,
        );
      }
    }
    expect(
      items.find((i) => i.item.id === "trouble-download")!.item.values,
    ).toEqual({ dlMinutes: DL_TOKEN_TTL_SECONDS / 60 });
    expect(items.find((i) => i.item.id === "start-brand")!.item.values).toEqual(
      { logoKb: LOGO_MAX_BYTES / 1024 },
    );
    expect(
      items.find((i) => i.item.id === "photos-remove")!.item.values,
    ).toEqual({ graceMinutes: SYNC_DELETE_GRACE_MS / 60000 });
    expect(items.find((i) => i.item.id === "trouble-pin")!.item.values).toEqual(
      { pinMaxAttempts: PIN_MAX_ATTEMPTS },
    );
  });
  it("names of panels, tabs, states and modes are never typed by hand (they are placeholders)", () => {
    const PREFIXES = [
      "admin.nav.",
      "admin.tabs.",
      "admin.edit.section.",
      "admin.setup.section.",
      "admin.clients.section.",
      "admin.state.",
      "admin.mode.",
      "admin.filter.",
    ];
    for (const lang of ["es", "en"] as const) {
      const dict = (lang === "es" ? es : en) as Record<string, string>;
      const names = new Set(
        Object.entries(dict)
          .filter(([k]) => PREFIXES.some((p) => k.startsWith(p)))
          .map(([, v]) => v)
          .filter((v) => v.length >= 4 && !v.includes("{") && !/[.:]/.test(v)),
      );
      const ALLOWED = new Set(["Google Drive"]); // the product, not a panel
      for (const { item } of items)
        for (const text of Object.values(rawTexts(lang, item)).flat()) {
          if (typeof text !== "string") continue;
          const plain = text.replace(/`[^`]*`/g, " ").replace(/\{\w+\}/g, " ");
          for (const n of names) {
            if (ALLOWED.has(n)) continue;
            const re = new RegExp(`(^|[^\\p{L}])${n}($|[^\\p{L}])`, "gu");
            for (const m of plain.matchAll(re)) {
              // A capital at the start of a sentence is just grammar.
              const before = plain.slice(0, m.index + m[1].length);
              if (/(^|[.!?:]\s*)$/.test(before)) continue;
              expect.fail(`${lang} ${item.id}: "${n}" typed by hand`);
            }
          }
          expect(plain, `${lang} ${item.id}`).not.toMatch(
            /(secci[oó]n|section) Google Drive|Google Drive (section|secci)/,
          );
        }
    }
  });
});
