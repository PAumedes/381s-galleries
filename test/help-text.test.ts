import { describe, expect, it } from "vitest";
import { es } from "../app/i18n/es";
import { en } from "../app/i18n/en";
import { makeT } from "../app/i18n/t";
import type { HelpItem } from "../app/lib/help";
import {
  foldForSearch,
  helpMatches,
  rawHelpItem,
  resolveHelpItem,
  tokenizeHelp,
} from "../app/lib/help-text";

describe("T6.57 help text: tokenizer", () => {
  it("splits plain text, code spans and placeholders", () => {
    expect(tokenizeHelp("Abrí `high-res` y tocá {publish}.")).toEqual([
      { kind: "text", text: "Abrí " },
      { kind: "code", text: "high-res" },
      { kind: "text", text: " y tocá " },
      { kind: "placeholder", name: "publish" },
      { kind: "text", text: "." },
    ]);
  });
  it("leaves unknown braces and lone backticks as text", () => {
    expect(tokenizeHelp("a { b } ` c")).toEqual([
      { kind: "text", text: "a { b } ` c" },
    ]);
    expect(tokenizeHelp("")).toEqual([]);
  });
});

const item: HelpItem = {
  id: "demo-x",
  steps: 1,
  lead: true,
  labels: { go: "admin.edit.action.publish" },
  values: { n: 6 },
};

describe("T6.57 help text: resolve", () => {
  const dict = {
    ...es,
    "admin.help.demo-x.q": "¿Cómo publico?",
    "admin.help.demo-x.a": "Hacelo en {n} pasos con `x`.",
    "admin.help.demo-x.s1": "Tocá {go}.",
  } as typeof es;
  it("fills labels as «Label» and values, strips code ticks", () => {
    const r = resolveHelpItem(item, makeT("es", dict));
    expect(r.q).toBe("¿Cómo publico?");
    expect(r.a).toBe("Hacelo en 6 pasos con x.");
    expect(r.steps).toEqual(["Tocá «Publicar»."]);
  });
  it("uses the language's own label", () => {
    const denDict = { ...en, "admin.help.demo-x.s1": "Tap {go}." } as typeof en;
    expect(resolveHelpItem(item, makeT("en", denDict)).steps).toEqual([
      "Tap «Publish».",
    ]);
  });
  it("rawHelpItem keeps placeholders for rendering", () => {
    const r = rawHelpItem(item, makeT("es", dict));
    expect(r.steps).toEqual(["Tocá {go}."]);
  });
});

describe("T6.57 help text: search", () => {
  const r = {
    q: "¿Cómo subo fotos?",
    a: "Exportá desde Capture One.",
    steps: ["Esperá la sincronización."],
  };
  it("folds case and accents", () => {
    expect(foldForSearch("SINCRONIZACIÓN")).toBe("sincronizacion");
  });
  it("matches every word, in the question, answer or steps, ignoring accents", () => {
    expect(helpMatches(r, "")).toBe(true);
    expect(helpMatches(r, "   ")).toBe(true);
    expect(helpMatches(r, "como SUBO")).toBe(true);
    expect(helpMatches(r, "capture")).toBe(true);
    expect(helpMatches(r, "sincronizacion")).toBe(true);
    expect(helpMatches(r, "capture pin")).toBe(false);
    expect(helpMatches(r, "zzz")).toBe(false);
  });
});
