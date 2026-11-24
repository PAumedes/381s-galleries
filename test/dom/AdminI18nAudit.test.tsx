import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The admin is bilingual (es/en): user-visible copy must come from t().
// This scans the admin sources with the TypeScript parser and reports every
// hard-coded string that would reach the screen.

const ROOT = join(import.meta.dirname, "../..");
const APP = join(ROOT, "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = [
  ...walk(join(APP, "components/admin")),
  ...readdirSync(join(APP, "routes"))
    .filter((f) => /^admin.*\.tsx?$/.test(f))
    .map((f) => join(APP, "routes", f)),
  // Server-side messages returned to the admin UI.
  join(APP, "lib/server/admin-galleries.ts"),
  join(APP, "lib/server/admin-clients.ts"),
  ...walk(join(APP, "lib/server/admin-clients")),
  ...walk(join(APP, "lib/server/admin-galleries")),
].filter((f) => /\.tsx?$/.test(f));

/**
 * Strings that are allowed to be literal. Every entry says why.
 * Matched against the trimmed string.
 */
const ALLOW: Record<string, string> = {
  ES: "language toggle label (a language's own code)",
  EN: "language toggle label (a language's own code)",
  PIN: "technical token, same word in both languages",
  QR: "technical token",
  "381 Studios": "brand name",
  "Google Drive": "brand name",
  Google: "brand name",
  "Capture One": "brand name",
  Montserrat: "typeface name",
  Instagram: "brand name",
  "preview-wm": "Capture One recipe folder name",
  "thumb-wm": "Capture One recipe folder name",
  "high-res": "recipe folder name",
  "PIN: ____________": "printable card blank (card has its own es/en text map)",
  "https://drive.google.com/drive/folders/…": "example URL in a placeholder",
  "↳": "symbol",
  "←": "symbol",
  "—": "symbol",
};

// Outside JSX, a literal is reported only when it reads like Spanish prose
// (an accented letter / inverted mark, or a common Spanish function word
// together with a space): class names, URLs and technical tokens pass.
const ES_PROSE =
  /[áéíóúñ¿¡ÁÉÍÓÚÑ]|\b(el|la|los|las|del|que|para|con|una|sin|por)\b/;
const LETTERS = /\p{L}{2,}/u;
const ATTRS = new Set([
  "aria-label",
  "title",
  "placeholder",
  "alt",
  "aria-valuetext",
  "aria-description",
  "aria-roledescription",
  // props of our own components that render as text
  "label",
  "hint",
  "legend",
  "caption",
  "heading",
  "error",
]);

interface Hit {
  where: string;
  text: string;
}

/** Literal strings that can end up on screen from an expression (not call args). */
function textLiterals(
  e: ts.Expression,
): (
  ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression
)[] {
  if (
    ts.isStringLiteral(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    ts.isTemplateExpression(e)
  )
    return [e];
  if (ts.isParenthesizedExpression(e)) return textLiterals(e.expression);
  if (ts.isConditionalExpression(e))
    return [...textLiterals(e.whenTrue), ...textLiterals(e.whenFalse)];
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    if (
      k === ts.SyntaxKind.AmpersandAmpersandToken ||
      k === ts.SyntaxKind.BarBarToken ||
      k === ts.SyntaxKind.QuestionQuestionToken
    )
      return textLiterals(e.right);
    if (k === ts.SyntaxKind.PlusToken)
      return [...textLiterals(e.left), ...textLiterals(e.right)];
  }
  return [];
}

export function scan(file: string, src: string): Hit[] {
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: Hit[] = [];
  const add = (node: ts.Node, text: string) => {
    const s = text.replace(/\s+/g, " ").trim();
    if (!LETTERS.test(s) || Object.hasOwn(ALLOW, s)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    hits.push({ where: `${relative(ROOT, file)}:${line + 1}`, text: s });
  };
  const flat = (
    n:
      | ts.StringLiteral
      | ts.NoSubstitutionTemplateLiteral
      | ts.TemplateExpression,
  ) =>
    ts.isTemplateExpression(n)
      ? [n.head.text, ...n.templateSpans.map((x) => x.literal.text)].join(" ")
      : n.text;
  const seen = new Set<ts.Node>();
  const report = (e: ts.Expression) => {
    for (const l of textLiterals(e)) {
      seen.add(l);
      add(l, flat(l));
    }
  };
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) add(n, n.getText());
    else if (ts.isJsxAttribute(n)) {
      if (ATTRS.has(n.name.getText())) {
        const init = n.initializer;
        if (init && ts.isStringLiteral(init)) add(init, init.text);
        else if (init && ts.isJsxExpression(init) && init.expression)
          report(init.expression);
      }
    } else if (
      ts.isJsxExpression(n) &&
      (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent)) &&
      n.expression
    )
      report(n.expression);
    else if (
      (ts.isStringLiteral(n) ||
        ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateExpression(n)) &&
      !seen.has(n) &&
      !ts.isImportDeclaration(n.parent) &&
      !ts.isExportDeclaration(n.parent) &&
      !ts.isLiteralTypeNode(n.parent) &&
      !ts.isJsxAttribute(n.parent) &&
      !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)
    ) {
      const text = flat(n);
      if (
        ES_PROSE.test(text) &&
        (/[áéíóúñ¿¡ÁÉÍÓÚÑ]/.test(text) || text.includes(" "))
      )
        add(n, text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe("admin i18n audit: no hard-coded user-visible text", () => {
  it("scans the admin sources", () => {
    const names = files.map((f) => relative(APP, f));
    expect(names).toContain("components/admin/AdminShell.tsx");
    expect(names).toContain("components/admin/GalleryEditView.tsx");
    expect(names).toContain("routes/admin.setup.tsx");
    expect(names).toContain("routes/admin._index.tsx");
    expect(names).toContain("lib/server/admin-galleries.ts");
    expect(names).toContain("lib/server/admin-clients.ts");
    expect(names).toContain("lib/server/admin-clients/errors.ts");
    expect(names).toContain(
      "lib/server/admin-galleries/actions/client-assignment.ts",
    );
  });

  it.each(files.map((f) => [relative(APP, f), f]))("%s", (_n, f) => {
    expect(scan(f, readFileSync(f, "utf8"))).toEqual([]);
  });

  describe("the scanner", () => {
    it("catches JSX text, attributes and Spanish prose literals", () => {
      const hits = scan(
        "x.tsx",
        `export const A = () => <div>
          <p>Guardar cambios</p>
          <input aria-label="Buscar" title={"Título"} placeholder='Nombre' alt="Foto" />
          {cond ? "Sí, seguro" : null}
          <b>{\`Hola \${x}\`}</b>
        </div>;
        const m = "No se pudo guardar el archivo";
        const n = \`Revisá los campos\`;`,
      );
      expect(hits.map((h) => h.text)).toEqual([
        "Guardar cambios",
        "Buscar",
        "Título",
        "Nombre",
        "Foto",
        "Sí, seguro",
        "Hola",
        "No se pudo guardar el archivo",
        "Revisá los campos",
      ]);
    });
    it("lets allowlisted tokens, symbols, class names and t() calls pass", () => {
      expect(
        scan(
          "x.tsx",
          `import x from "../react-router";
          export const A = () => <div className="flex items-center gap-2 text-small" data-x="y">
            <button>ES</button><i>EN</i><span>—</span><b>{t("admin.save")}</b>
            <code>PIN</code>
          </div>;`,
        ),
      ).toEqual([]);
    });
  });
});
