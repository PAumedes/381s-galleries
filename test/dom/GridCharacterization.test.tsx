import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Grid } from "../../app/components/Grid";
import { photos, t } from "./fixtures";

const noop = () => {};
const html = (props: Partial<Parameters<typeof Grid>[0]> = {}) =>
  render(
    <Grid
      photos={photos(7)}
      t={t}
      onOpen={noop}
      initialWidth={900}
      {...props}
    />,
  ).container.innerHTML;

describe("T6.48 Grid markup (golden, pre-refactor)", () => {
  for (const layout of ["filas", "cuadricula", "columnas"] as const)
    for (const gap of [2, 16])
      it(`${layout} gap ${gap}`, () => {
        expect(html({ layout, gap })).toMatchSnapshot();
      });
  it("actions, favourites and protection", () => {
    expect(
      html({
        onFavorite: noop,
        onDownload: noop,
        isFavorite: (id) => id === "p1",
        protect: true,
      }),
    ).toMatchSnapshot("both");
    expect(html({ onFavorite: noop })).toMatchSnapshot("favourite only");
    expect(html({ onDownload: noop })).toMatchSnapshot("download only");
    expect(html({ photos: [] })).toMatchSnapshot("empty");
  });
  it("image error shows retry, retry reloads with a cache-buster", () => {
    const c = render(
      <Grid photos={photos(2)} t={t} onOpen={noop} initialWidth={900} />,
    );
    const img = () => c.container.querySelector("img")!;
    fireEvent.error(img());
    expect(c.container.innerHTML).toMatchSnapshot("failed");
    fireEvent.click(c.getByTestId("retry-0"));
    expect(c.container.innerHTML).toMatchSnapshot("retrying");
    fireEvent.load(img());
    expect(c.container.innerHTML).toMatchSnapshot("loaded");
  });
});
