import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { LanguageToggle } from "../../app/components/LanguageToggle";
import { es } from "../../app/i18n/es";

function hrefs(initial: string): string[] {
  const router = createMemoryRouter(
    [
      {
        id: "root",
        path: "*",
        loader: () => ({ lang: "es", messages: es }),
        element: createElement(LanguageToggle),
        hydrateFallbackElement: null,
      },
    ],
    {
      initialEntries: [initial],
      hydrationData: { loaderData: { root: { lang: "es", messages: es } } },
    },
  );
  const html = renderToString(createElement(RouterProvider, { router }));
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
}

describe("T2.0 LanguageToggle href", () => {
  it("never emits a protocol-relative href when the path starts with //", () => {
    const out = hrefs("//evil.example/x");
    expect(out.length).toBeGreaterThan(0);
    for (const h of out) expect(h.startsWith("//")).toBe(false);
  });
});
