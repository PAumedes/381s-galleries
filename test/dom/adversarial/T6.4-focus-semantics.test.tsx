import { fireEvent, render } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { CoverPreview } from "../../../app/components/admin/CoverPreview";

const FRAMES = {
  desktop: { w: 1280, h: 720 },
  mobile: { w: 390, h: 823 },
} as const;

// happy-dom has no layout: give the cover header and the picker box real sizes.
const sizes = {
  frame: { w: 1280, h: 720 } as { w: number; h: number },
};
const proto = HTMLElement.prototype;
const origW = Object.getOwnPropertyDescriptor(proto, "clientWidth");
const origH = Object.getOwnPropertyDescriptor(proto, "clientHeight");
function stubLayout() {
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.coverImg !== undefined) return sizes.frame.w;
      if (this.dataset.testid === "focus-box") return 400;
      return 0;
    },
  });
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.coverImg !== undefined) return sizes.frame.h;
      if (this.dataset.testid === "focus-box") return 300;
      return 0;
    },
  });
}
afterEach(() => {
  if (origW) Object.defineProperty(proto, "clientWidth", origW);
  if (origH) Object.defineProperty(proto, "clientHeight", origH);
});

function show(img = { w: 3000, h: 2000 }) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <CoverPreview
          title="T"
          eventDate={null}
          palette="claro"
          coverLayout="completa"
          proofing={false}
          coverId="p1"
          coverWidth={img.w}
          coverHeight={img.h}
          initialFocus={null}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

/** CSS object-fit: cover + object-position: where an image point lands (0..1 of frame). */
function landing(
  img: { w: number; h: number },
  fr: { w: number; h: number },
  pos: { x: number; y: number }, // percent
  pt: { x: number; y: number }, // fraction of the image
) {
  const s = Math.max(fr.w / img.w, fr.h / img.h);
  const sw = img.w * s;
  const sh = img.h * s;
  const ox = (fr.w - sw) * (pos.x / 100);
  const oy = (fr.h - sh) * (pos.y / 100);
  return { x: (pt.x * sw + ox) / fr.w, y: (pt.y * sh + oy) / fr.h, sw, sh };
}

/** Best achievable landing of `pt` on one axis: as close to the center as the crop allows. */
function best(sizeScaled: number, frame: number, frac: number) {
  const over = sizeScaled - frame;
  if (over <= 0) return null; // axis not cropped
  const p = Math.min(1, Math.max(0, (frac * sizeScaled - frame / 2) / over));
  return (frac * sizeScaled - over * p) / frame;
}

describe("T6.4 focal point: the point the admin clicks must be the point that is kept in view", () => {
  const cases = [
    ["portrait photo, desktop frame", { w: 2000, h: 3000 }, "desktop"],
    ["landscape photo, mobile frame", { w: 3000, h: 2000 }, "mobile"],
    ["landscape photo, desktop frame", { w: 3000, h: 2000 }, "desktop"],
    ["portrait photo, mobile frame", { w: 2000, h: 3000 }, "mobile"],
  ] as const;
  for (const [name, img, view] of cases) {
    it(name, () => {
      const fr = FRAMES[view];
      sizes.frame = fr;
      stubLayout();
      const { container, getByRole, getByTestId } = show(img);
      if (view === "mobile")
        fireEvent.click(getByRole("button", { name: "Móvil" }));
      // The picker shows the whole photo, contained in a 400x300 box.
      const w = Math.min(400, 300 * (img.w / img.h));
      const h = w / (img.w / img.h);
      getByTestId("focus-picker").getBoundingClientRect = () =>
        ({
          left: (400 - w) / 2,
          top: (300 - h) / 2,
          width: w,
          height: h,
        }) as DOMRect;
      // A subject at 40% / 35% of the PHOTO: click exactly on it.
      const subject = { x: 0.4, y: 0.35 };
      fireEvent.click(getByTestId("focus-picker"), {
        clientX: (400 - w) / 2 + subject.x * w,
        clientY: (300 - h) / 2 + subject.y * h,
      });
      const fx = Number(
        (container.querySelector("input[name=focusX]") as HTMLInputElement)
          .value,
      );
      const fy = Number(
        (container.querySelector("input[name=focusY]") as HTMLInputElement)
          .value,
      );
      // The stored value is the point on the image itself.
      expect(fx).toBeCloseTo(40, 0);
      expect(fy).toBeCloseTo(35, 0);
      // And the rendered cover keeps it as near the frame center as the crop allows.
      const op = (
        container.querySelector("img[data-cover-img]") as HTMLElement
      ).style.objectPosition.split(" ");
      const after = landing(
        img,
        fr,
        { x: parseFloat(op[0]!), y: parseFloat(op[1]!) },
        subject,
      );
      const bx = best(after.sw, fr.w, subject.x);
      const by = best(after.sh, fr.h, subject.y);
      if (bx !== null) expect(after.x).toBeCloseTo(bx, 1);
      if (by !== null) expect(after.y).toBeCloseTo(by, 1);
    });
  }
});

describe("T6.4 keyboard focal point must always produce a value the server accepts", () => {
  it("click at 5.3% then ArrowLeft", () => {
    const { container, getByTestId } = show();
    const picker = getByTestId("focus-picker");
    picker.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 562.5 }) as DOMRect;
    fireEvent.click(picker, { clientX: 53, clientY: 281 });
    fireEvent.keyDown(picker, { key: "ArrowLeft" });
    const v = (
      container.querySelector("input[name=focusX]") as HTMLInputElement
    ).value;
    expect(Number(v)).toBeCloseTo(0.3, 5);
    expect(v).toMatch(/^\d{1,3}(?:\.\d)?$/); // one decimal at most
  });
});
