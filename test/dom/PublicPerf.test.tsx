import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryView } from "../../app/components/GalleryView";
import { StatusSection } from "../../app/components/admin/gallery-edit/StatusSection";
import { photoImgProps } from "../../app/components/lightbox/srcset";
import { imgUrl, type OpenGallery } from "../../app/components/types";
import { allMessages } from "../../app/i18n/dictionaries";

/**
 * What a browser downloads for an <img srcset sizes> at a viewport / DPR
 * (w-descriptor candidates, `sizes` = "(min-width: Npx) Xvw, Yvw" or "Yvw").
 */
function pick(srcset: string, sizes: string, viewport: number, dpr: number) {
  let slot = sizes;
  for (const part of sizes.split(/,(?![^(]*\))/)) {
    const m = /^\s*\(min-width:\s*(\d+)px\)\s+(\d+)vw\s*$/.exec(part);
    if (m && viewport >= Number(m[1])) {
      slot = `${m[2]}vw`;
      break;
    }
    if (!m) slot = part.trim();
  }
  const need = (parseFloat(slot) / 100) * viewport * dpr;
  const cands = srcset.split(",").map((c) => {
    const [url, w] = c.trim().split(/\s+/);
    return { url, w: parseInt(w) };
  });
  cands.sort((a, b) => a.w - b.w);
  return (cands.find((c) => c.w >= need) ?? cands[cands.length - 1]).url;
}

const gallery = (over: Partial<OpenGallery> = {}): OpenGallery => ({
  slug: "boda",
  requireEmail: false,
  title: "Boda Ana",
  eventDate: null,
  coverPhotoId: "c0",
  allowBulk: false,
  allowHighres: false,
  allowWeb: false,
  allowIg: false,
  mode: "delivery",
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
  sets: [{ name: "A", count: 2 }],
  ...over,
});
const photos = ["c0", "m0"].map((id) => ({
  id,
  width: 3000,
  height: 2000,
  set: "A",
  variants: { web: true, ig: true },
  v: "tok",
}));

function stub(node: ReactNode, lang: "en" | "es" = "en") {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang, messages: allMessages(lang), studioName: "S" }),
      Component: () => <>{node}</>,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ visitor: null, favorites: [] })),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("T6.37 cover image size", () => {
  it("cover offers view-sm (1200w) and view-lg (2048w); a 412px / 2.6 DPR phone gets view-sm", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await screen.findByRole("heading", { level: 1, name: "Boda Ana" });
    const img = document.querySelector<HTMLImageElement>(
      "img[data-cover-img]",
    )!;
    expect(img.getAttribute("src")).toBe("/img/c0/view-sm?v=tok");
    const srcset = img.getAttribute("srcset")!;
    const sizes = img.getAttribute("sizes")!;
    expect(srcset).toBe(
      "/img/c0/view-sm?v=tok 1200w, /img/c0/view-lg?v=tok 2048w",
    );
    expect(pick(srcset, sizes, 412, 2.6)).toBe("/img/c0/view-sm?v=tok");
    expect(pick(srcset, sizes, 1920, 1)).toBe("/img/c0/view-lg?v=tok");
    expect(img.getAttribute("fetchpriority")).toBe("high");
  });

  it("mobile cover <source> has the same candidates, phones pick view-sm", async () => {
    stub(
      <GalleryView
        gallery={gallery({ coverPhotoIdMobile: "m0" })}
        photos={photos}
      />,
    );
    await screen.findByRole("heading", { level: 1, name: "Boda Ana" });
    const source = document.querySelector("picture source")!;
    const srcset = source.getAttribute("srcset")!;
    expect(srcset).toBe(
      "/img/m0/view-sm?v=tok 1200w, /img/m0/view-lg?v=tok 2048w",
    );
    expect(pick(srcset, source.getAttribute("sizes")!, 412, 2.6)).toBe(
      "/img/m0/view-sm?v=tok",
    );
  });

  it("lightbox: a 412px / 2.6 DPR phone gets view-sm, a desktop view-lg", () => {
    const p = photoImgProps(imgUrl, photos[0]);
    expect(pick(p.srcSet, p.sizes, 412, 2.6)).toBe("/img/c0/view-sm?v=tok");
    expect(pick(p.srcSet, p.sizes, 1440, 1)).toBe("/img/c0/view-lg?v=tok");
  });
});

describe("T6.37 photos-ready indicator (admin)", () => {
  const show = (
    lang: "en" | "es",
    status: "draft" | "published" | "archived",
    progress: { warmed: number; total: number } | null,
  ) =>
    stub(
      <StatusSection
        status={status}
        busy={false}
        actionData={undefined}
        cacheProgress={progress}
      />,
      lang,
    );

  it("published: 'N / M' in Spanish and English", async () => {
    show("es", "published", { warmed: 3, total: 10 });
    expect(await screen.findByTestId("photos-ready")).toBeTruthy();
    expect(screen.getByTestId("photos-ready").textContent).toBe(
      "Fotos listas: 3 / 10",
    );
  });
  it("english", async () => {
    show("en", "published", { warmed: 10, total: 10 });
    expect((await screen.findByTestId("photos-ready")).textContent).toBe(
      "Photos ready: 10 / 10",
    );
  });
  it("hidden for drafts, archived, no photos or no data", async () => {
    show("es", "draft", { warmed: 0, total: 5 });
    await screen.findByText("Publicar");
    expect(screen.queryByTestId("photos-ready")).toBeNull();
  });
  it("hidden when there is no progress (mock mode) or an empty gallery", async () => {
    show("es", "published", null);
    await screen.findByText("Pasar a borrador");
    expect(screen.queryByTestId("photos-ready")).toBeNull();
  });
  it("hidden for an empty gallery", async () => {
    show("es", "published", { warmed: 0, total: 0 });
    await screen.findByText("Pasar a borrador");
    expect(screen.queryByTestId("photos-ready")).toBeNull();
  });
});
