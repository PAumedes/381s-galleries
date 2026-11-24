import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router";
import { describe, expect, it } from "vitest";
import { ClientEditView } from "../../app/components/admin/clients/ClientEditView";
import { es } from "../../app/i18n/es";

describe("T6.40c canonical URL everywhere", () => {
  it("the client page lists each album with its canonical /<client>/<album> path", async () => {
    const routes = [
      {
        id: "root",
        path: "/",
        loader: () => ({ lang: "es", messages: es }),
        children: [
          {
            path: "admin",
            Component: () =>
              h(ClientEditView, {
                client: {
                  id: "c",
                  name: "Acme",
                  slug: "acme",
                  pageEnabled: true,
                  defaultMode: "delivery",
                  defaultShowOnHome: false,
                },
                publicPage: { visible: 1, reason: null },
                albums: [
                  {
                    id: "a",
                    title: "Boda",
                    slug: "boda",
                    status: "published",
                    mode: "delivery",
                  },
                ],
                actionData: undefined,
              }),
          },
        ],
      },
    ];
    const handler = createStaticHandler(routes);
    const ctx = await handler.query(new Request("http://x/admin"));
    const router = createStaticRouter(handler.dataRoutes, ctx);
    const html = renderToString(
      h(StaticRouterProvider, { router, context: ctx, hydrate: false }),
    );
    expect(html).toContain("/acme/boda");
  });
});
