import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Client components must take user-facing text from t(). components/admin/ is covered by AdminI18nAudit.test.tsx.
const DIR = join(import.meta.dirname, "../../app/components");
const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));

const ES_WORDS =
  /\b(galería|galerias|galería|descargar|descarga|favoritos?|favoritas?|cerrar|siguiente|anterior|compartir|ingresá|ingresar|contraseña|enviar|volver|cargando|error|todas?|fotos?|resolución|cancelar|aceptar|guardar|copiado|enlace|vence|disponible|verificá|intentá|inválido)\b/i;
const EN_WORDS =
  /\b(download|close|next|previous|share|cancel|loading|favorites?|gallery|submit|email|password|copied|retry|try again)\b/i;

/** String literals in JSX text (>text<) and in user-facing attributes. */
function literals(src: string): string[] {
  const out: string[] = [];
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // Text between tags; code that merely looks like it (generics) has ; ( ) = etc.
  for (const m of code.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g))
    if (!/[;()=]/.test(m[1])) out.push(m[1]);
  for (const m of code.matchAll(
    /\b(?:aria-label|title|placeholder|alt)="([^"]+)"/g,
  ))
    out.push(m[1]);
  return out.filter((s) => /[A-Za-zÀ-ÿ]{3,}/.test(s));
}

describe("i18n audit: no hardcoded copy in client components", () => {
  it("scans the expected files", () => {
    expect(files).toContain("GalleryView.tsx");
    expect(files).toContain("PinScreen.tsx");
  });
  it.each(files)("%s has no hardcoded Spanish/English UI strings", (f) => {
    const src = readFileSync(join(DIR, f), "utf8");
    const bad = literals(src).filter(
      (s) => ES_WORDS.test(s) || EN_WORDS.test(s),
    );
    expect(bad).toEqual([]);
  });
  it("the scanner catches a hardcoded string", () => {
    expect(literals(`<p>Descargar todo</p><a aria-label="Cerrar" />`)).toEqual([
      "Descargar todo",
      "Cerrar",
    ]);
  });
});
