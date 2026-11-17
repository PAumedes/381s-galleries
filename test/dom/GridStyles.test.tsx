import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Grid } from "../../app/components/Grid";
import { photos, t } from "./fixtures";

const boxes = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const el = screen.getByTestId(`tile-${i}`);
    return {
      i,
      left: parseFloat(el.style.left),
      top: parseFloat(el.style.top),
      width: parseFloat(el.style.width),
      height: parseFloat(el.style.height),
    };
  });

function show(
  style: "filas" | "cuadricula" | "columnas",
  gap: number,
  n = 14,
  width = 1200,
) {
  return render(
    <Grid
      photos={photos(n)}
      t={t}
      onOpen={() => {}}
      layout={style}
      gap={gap}
      initialWidth={width}
    />,
  );
}

describe("Grid styles", () => {
  it("cuadricula: uniform squares, 4 columns at 1200px, gap applied, object-cover", () => {
    show("cuadricula", 16);
    const b = boxes(14);
    const col = (1200 - 3 * 16) / 4;
    for (const x of b) {
      expect(x.width).toBeCloseTo(col, 1);
      expect(x.height).toBeCloseTo(col, 1);
    }
    expect(b[1].left - (b[0].left + b[0].width)).toBeCloseTo(16, 1);
    expect(b[4].top).toBeCloseTo(col + 16, 1);
    expect(
      screen.getByTestId("open-0").querySelector("img")!.className,
    ).toMatch(/object-cover/);
  });

  it("cuadricula: 3 columns at 800px, 2 at 400px", () => {
    const a = show("cuadricula", 6, 6, 800);
    expect(boxes(6)[3].top).toBeGreaterThan(0);
    expect(boxes(6)[2].top).toBe(0);
    a.unmount();
    show("cuadricula", 6, 6, 400);
    expect(boxes(6)[1].top).toBe(0);
    expect(boxes(6)[2].top).toBeGreaterThan(0);
  });

  it("columnas: preserves aspect ratio, 4 columns at 1200px", () => {
    show("columnas", 6);
    const b = boxes(14);
    const ps = photos(14);
    for (const x of b)
      expect(x.width / x.height).toBeCloseTo(
        ps[x.i].width! / ps[x.i].height!,
        1,
      );
    expect(new Set(b.map((x) => Math.round(x.left))).size).toBe(4);
  });

  it("filas: justified rows with the requested gap (2 / 6 / 16)", () => {
    for (const gap of [2, 6, 16]) {
      const { unmount } = show("filas", gap, 8);
      const b = boxes(8);
      const row = b.filter((x) => x.top === b[0].top);
      expect(row.length).toBeGreaterThan(1);
      expect(row[1].left - (row[0].left + row[0].width)).toBe(gap);
      unmount();
    }
  });

  it("DOM order == photo order == visual order (top, then left) in every style", () => {
    for (const style of ["filas", "cuadricula", "columnas"] as const) {
      for (const w of [1200, 800, 400]) {
        const { unmount } = show(style, 6, 23, w);
        const visual = boxes(23)
          .sort((a, b) => a.top - b.top || a.left - b.left)
          .map((x) => x.i);
        expect(visual, `${style} @${w}`).toEqual(
          Array.from({ length: 23 }, (_, i) => i),
        );
        const dom = screen
          .getAllByTestId(/^tile-\d+$/)
          .map((el) =>
            Number(
              el.dataset.testid?.slice(5) ??
                el.getAttribute("data-testid")!.slice(5),
            ),
          );
        expect(dom).toEqual(Array.from({ length: 23 }, (_, i) => i));
        unmount();
      }
    }
  });

  it("defaults to filas / 6px when no style or gap is given", () => {
    render(<Grid photos={photos(8)} t={t} onOpen={() => {}} />);
    const b = boxes(8);
    const row = b.filter((x) => x.top === b[0].top);
    expect(row[1].left - (row[0].left + row[0].width)).toBe(6);
  });
});
