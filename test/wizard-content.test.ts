import { describe, expect, it } from "vitest";
import { en } from "../app/i18n/en";
import { enWizard } from "../app/i18n/en.wizard";
import { es } from "../app/i18n/es";
import { esWizard } from "../app/i18n/es.wizard";
import { makeT } from "../app/i18n/t";
import { HELP_SECTIONS } from "../app/lib/help";
import { tokenizeHelp } from "../app/lib/help-text";
import { PIN_MAX, PIN_MIN } from "../app/lib/pin-rules";
import {
  parseWizardStep,
  resolveWizardText,
  WIZARD_PAGE_KEYS,
  WIZARD_STEP_COUNT,
  WIZARD_STEPS,
  wizardStates,
  wizardStepHref,
  wizardStepKeys,
} from "../app/lib/wizard";
import { SYNC_INTERVAL_MINUTES } from "../app/lib/server/sync-types";

// T6.58: structure and words of the first-run wizard (same rules as the help).

const LANGS = [
  ["es", es, esWizard],
  ["en", en, enWizard],
] as const;
const HELP_IDS = new Set(
  HELP_SECTIONS.flatMap((s) => s.items.map((i) => i.id)),
);

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

const dictOf = (d: unknown) => d as Record<string, string>;

describe("T6.58 wizard: structure", () => {
  it("has exactly six steps with unique kebab-case ids", () => {
    expect(WIZARD_STEP_COUNT).toBe(6);
    expect(WIZARD_STEPS.map((s) => s.id)).toEqual([
      "drive",
      "folders",
      "client",
      "gallery",
      "settings",
      "share",
    ]);
  });

  it("every help link names a real help question", () => {
    for (const s of WIZARD_STEPS) {
      for (const h of s.help)
        expect(HELP_IDS.has(h), `${s.id} ${h}`).toBe(true);
      for (const l of s.lines)
        if (l.help)
          expect(HELP_IDS.has(l.help), `${s.id} line ${l.help}`).toBe(true);
    }
  });

  it("the settings step has one line per key setting, each with its help", () => {
    const s = WIZARD_STEPS.find((x) => x.id === "settings")!;
    expect(s.lines.map((l) => l.help)).toEqual([
      "albums-publish",
      "access-pin-album",
      "proof-modes",
      "proof-sizes",
      "albums-expiry",
    ]);
  });

  it("step urls are plain query links and parse back; bad input is null", () => {
    expect(wizardStepHref(3)).toBe("/admin/empezar?paso=3");
    for (let n = 1; n <= 6; n++) expect(parseWizardStep(String(n))).toBe(n);
    for (const bad of [
      null,
      "",
      "0",
      "7",
      "-1",
      "01",
      "1.5",
      "abc",
      " 2",
      "2 ",
    ])
      expect(parseWizardStep(bad), String(bad)).toBeNull();
  });

  it("states: pure function of the facts", () => {
    const f = { driveReady: false, clients: 0, galleries: 0, published: 0 };
    expect(wizardStates(f)).toEqual([
      "todo",
      "read",
      "optional",
      "todo",
      "todo",
      "read",
    ]);
    expect(
      wizardStates({
        driveReady: true,
        clients: 2,
        galleries: 3,
        published: 1,
      }),
    ).toEqual(["done", "read", "done", "done", "done", "read"]);
    // A published gallery cannot exist without being counted, but the rule is by published count.
    expect(wizardStates({ ...f, galleries: 1 })[4]).toBe("todo");
  });
});

describe.each(LANGS)("T6.58 wizard dictionary (%s)", (lang, all, words) => {
  it("has every key of the steps and the page, non-empty, and no orphans", () => {
    const expected = new Set<string>(WIZARD_PAGE_KEYS);
    for (const s of WIZARD_STEPS) {
      const k = wizardStepKeys(s);
      expected.add(k.title);
      expected.add(k.lead);
      k.lines.forEach((x) => expected.add(x));
    }
    for (const key of expected) {
      const v = dictOf(words)[key];
      expect(typeof v, `${lang} ${key}`).toBe("string");
      expect(v!.trim().length, `${lang} ${key}`).toBeGreaterThan(0);
    }
    expect(Object.keys(words).filter((k) => !expected.has(k))).toEqual([]);
  });

  it("is merged into the full dictionary, admin keys only", () => {
    for (const [k, v] of Object.entries(words)) {
      expect(dictOf(all)[k]).toBe(v);
      expect(k.startsWith("admin.")).toBe(true);
    }
  });

  it("is short: titles, a lead of up to 3 sentences, lines of up to 2", () => {
    for (const s of WIZARD_STEPS) {
      const k = wizardStepKeys(s);
      const id = `${lang} ${s.id}`;
      expect(dictOf(words)[k.title]!.length, `${id} title`).toBeLessThanOrEqual(
        60,
      );
      const lead = dictOf(words)[k.lead]!;
      expect(lead.length, `${id} lead`).toBeLessThanOrEqual(230);
      expect(sentences(lead), `${id} lead`).toBeLessThanOrEqual(3);
      expect(k.lines.length, `${id} lines`).toBeLessThanOrEqual(6);
      for (const l of k.lines) {
        const v = dictOf(words)[l]!;
        expect(v.length, l).toBeLessThanOrEqual(150);
        expect(sentences(v), l).toBeLessThanOrEqual(2);
      }
    }
    for (const key of WIZARD_PAGE_KEYS)
      expect(dictOf(words)[key]!.length, key).toBeLessThanOrEqual(200);
  });

  it("no jargon, emoji, ASCII double quotes, markup or double marks", () => {
    for (const [key, text] of Object.entries(words)) {
      const plain = text.replace(/`[^`]*`/g, " ").replace(/\{\w+\}/g, " ");
      for (const w of FORBIDDEN)
        expect(plain, `${lang} ${key} (${w})`).not.toMatch(forbiddenRe(w));
      expect(text, key).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text, key).not.toMatch(/["<>]/);
      expect(text, key).not.toMatch(/!{2,}|\?{2,}/);
      expect(text, key).toBe(text.trim());
      expect((text.match(/`/g) ?? []).length % 2, key).toBe(0);
    }
  });

  it("placeholders: every one is declared by its step, every declaration is used", () => {
    for (const s of WIZARD_STEPS) {
      const k = wizardStepKeys(s);
      const used = new Set<string>();
      for (const key of [k.title, k.lead, ...k.lines])
        for (const m of dictOf(words)[key]!.matchAll(/\{(\w+)\}/g))
          used.add(m[1]!);
      const declared = new Set([
        ...Object.keys(s.labels ?? {}),
        ...Object.keys(s.values ?? {}),
      ]);
      for (const u of used)
        expect(declared.has(u), `${lang} ${s.id} {${u}}`).toBe(true);
    }
  });

  it("labels exist in the real dictionary and show up in typographic quotes", () => {
    const t = makeT(lang, all);
    for (const s of WIZARD_STEPS)
      for (const key of Object.values(s.labels ?? {}))
        expect(dictOf(all)[key], `${s.id} ${key}`).toBeTruthy();
    for (const s of WIZARD_STEPS) {
      const k = wizardStepKeys(s);
      const text = [k.title, k.lead, ...k.lines]
        .map((key) => resolveWizardText(s, t(key), t))
        .join("\n");
      expect(text).not.toMatch(/\{\w+\}/);
      for (const key of Object.values(s.labels ?? {}))
        expect(text, `${lang} ${s.id} ${key}`).toContain(
          `«${dictOf(all)[key]}»`,
        );
    }
  });

  it("numbers come from the one definition the server uses", () => {
    const t = makeT(lang, all);
    const settings = WIZARD_STEPS.find((s) => s.id === "settings")!;
    expect(settings.values).toMatchObject({ pinMin: PIN_MIN, pinMax: PIN_MAX });
    const gallery = WIZARD_STEPS.find((s) => s.id === "gallery")!;
    expect(gallery.values).toMatchObject({
      syncMinutes: SYNC_INTERVAL_MINUTES,
    });
    const k = wizardStepKeys(gallery);
    const text = [k.lead, ...k.lines]
      .map((x) => resolveWizardText(gallery, t(x), t))
      .join(" ");
    expect(text).toContain(String(SYNC_INTERVAL_MINUTES));
  });

  it("the page keys carry a progress text with the numbers and a plain state word", () => {
    const t = makeT(lang, all);
    expect(t("admin.wizard.progress", { n: 3, total: 6 })).toMatch(/3/);
    expect(t("admin.wizard.progress", { n: 3, total: 6 })).toMatch(/6/);
    for (const s of ["done", "todo", "optional", "read"])
      expect(dictOf(words)[`admin.wizard.state.${s}`]).toBeTruthy();
  });
});

describe("T6.58 wizard: es and en say the same thing", () => {
  it("same keys, same placeholders, not copies", () => {
    expect(Object.keys(enWizard).sort()).toEqual(Object.keys(esWizard).sort());
    const ph = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const same: string[] = [];
    for (const k of Object.keys(esWizard)) {
      const a = dictOf(esWizard)[k]!;
      const b = dictOf(enWizard)[k]!;
      expect(ph(b), k).toEqual(ph(a));
      expect(
        tokenizeHelp(a)
          .filter((x) => x.kind === "code")
          .map((x) => x.text),
        k,
      ).toEqual(
        tokenizeHelp(b)
          .filter((x) => x.kind === "code")
          .map((x) => x.text),
      );
      if (a === b && /[a-z]{4,}/i.test(a)) same.push(k);
    }
    expect(same).toEqual([]);
  });
});
