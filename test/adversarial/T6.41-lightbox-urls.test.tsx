import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { Lightbox } from "../../app/components/Lightbox";
import { ImgUrlProvider, adminImgUrl } from "../../app/components/img-url";
import type { ImgUrlFn } from "../../app/components/types";
import { photos, t } from "../dom/fixtures";

const list = photos(6).map((p) => ({ ...p, v: "1" }));

function Harness({ url }: { url?: ImgUrlFn }) {
  const [i, setI] = useState(2);
  const lb = (
    <Lightbox photos={list} index={i} t={t} onClose={() => {}} onIndexChange={setI} />
  );
  return url ? <ImgUrlProvider value={url}>{lb}</ImgUrlProvider> : lb;
}

function urls(): string[] {
  const out: string[] = [];
  for (const el of document.querySelectorAll("img")) {
    out.push(el.getAttribute("src") ?? "");
    for (const c of (el.getAttribute("srcset") ?? "").split(",")) {
      if (c.trim()) out.push(c.trim().split(" ")[0]);
    }
  }
  return out.filter(Boolean);
}

async function walk(): Promise<string[]> {
  const seen = new Set<string>();
  const grab = () => urls().forEach((u) => seen.add(u));
  grab();
  for (let k = 0; k < 3; k++) {
    fireEvent.keyDown(document, { key: "ArrowRight" });
    await act(async () => {});
    grab();
  }
  for (let k = 0; k < 5; k++) {
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    await act(async () => {});
    grab();
  }
  return [...seen];
}

describe("T6.41 lightbox URLs", () => {
  it("public: every rendered URL is a /img variant (server watermarks Prueba)", async () => {
    render(<Harness />);
    const all = await walk();
    expect(all.length).toBeGreaterThan(3);
    for (const u of all)
      expect(u).toMatch(/^\/img\/p\d+\/(thumb|view-sm|view-lg)\?v=1$/);
  });

  it("admin Prueba preview: every rendered URL is a watermarked admin variant", async () => {
    render(<Harness url={adminImgUrl(true, {})} />);
    const all = await walk();
    for (const u of all) expect(u).toMatch(/^\/admin\/img\/p\d+\/(thumb|view-sm)-wm$/);
  });

  it("a11y: placeholders are aria-hidden and only one image has alt text", async () => {
    render(<Harness />);
    await walk();
    const named = [...document.querySelectorAll("img")].filter(
      (i) => i.getAttribute("alt") !== "" || !i.hasAttribute("alt"),
    );
    expect(named).toHaveLength(1);
    for (const i of document.querySelectorAll("img[alt='']"))
      expect(i.getAttribute("aria-hidden")).toBe("true");
  });

  it("failed full image: error state shown, no stray thumb left", async () => {
    render(<Harness />);
    fireEvent.error(screen.getByTestId("lightbox-img"));
    await act(async () => {});
    expect(screen.getByTestId("lightbox-error")).toBeTruthy();
    expect(document.querySelectorAll("img[src*='/thumb']")).toHaveLength(0);
  });
});
