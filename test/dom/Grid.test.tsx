import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Grid } from "../../app/components/Grid";
import { imgUrl } from "../../app/components/types";
import { photos, t } from "./fixtures";

describe("imgUrl", () => {
  it("builds /img/<id>/<variant>", () => {
    expect(imgUrl("abc", "thumb")).toBe("/img/abc/thumb");
    expect(imgUrl("abc", "view-lg")).toBe("/img/abc/view-lg");
  });
});

describe("Grid", () => {
  it("renders every tile with a lazy thumb img and numbered alt", () => {
    const ps = photos(8);
    render(<Grid photos={ps} t={t} onOpen={() => {}} />);
    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(8);
    imgs.forEach((img, i) => {
      expect(img.getAttribute("src")).toBe(`/img/p${i}/thumb`);
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("decoding")).toBe("async");
      expect(img.getAttribute("alt")).toBe(`Photo ${i + 1}`);
    });
  });

  it("renders server HTML with a fallback width (no empty grid)", async () => {
    const { renderToString } = await import("react-dom/server");
    const html = renderToString(
      <Grid photos={photos(5)} t={t} onOpen={() => {}} />,
    );
    expect(html).toContain("/img/p0/thumb");
    expect(html).toMatch(/width:\s*\d+px/);
  });

  it("gives tiles explicit pixel boxes (no layout shift)", () => {
    render(<Grid photos={photos(3)} t={t} onOpen={() => {}} />);
    const tile = screen.getByTestId("tile-0");
    expect(tile.style.width).toMatch(/^\d+px$/);
    expect(tile.style.height).toMatch(/^\d+px$/);
  });

  it("calls onOpen(index) on click and on Enter", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<Grid photos={photos(4)} t={t} onOpen={onOpen} />);
    const opens = screen.getAllByRole("button", { name: /Photo \d/ });
    await user.click(opens[2]);
    expect(onOpen).toHaveBeenLastCalledWith(2);
    opens[1].focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenLastCalledWith(1);
  });

  it("tiles are focusable in order", async () => {
    const user = userEvent.setup();
    render(<Grid photos={photos(3)} t={t} onOpen={() => {}} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId("open-0"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId("open-1"));
  });

  it("renders no action buttons without callbacks", () => {
    render(<Grid photos={photos(3)} t={t} onOpen={() => {}} />);
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.queryByRole("button", { name: /favorites/i })).toBeNull();
  });

  it("renders only the actions whose callbacks are given", () => {
    const { rerender } = render(
      <Grid photos={photos(2)} t={t} onOpen={() => {}} onDownload={() => {}} />,
    );
    expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /favorites/i })).toBeNull();
    rerender(
      <Grid
        photos={photos(2)}
        t={t}
        onOpen={() => {}}
        onFavorite={() => {}}
        isFavorite={() => false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Add to favorites" }),
    ).toHaveLength(2);
  });

  it("favorite/download fire with the id and do not open", async () => {
    const onOpen = vi.fn();
    const onFavorite = vi.fn();
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(
      <Grid
        photos={photos(3)}
        t={t}
        onOpen={onOpen}
        onFavorite={onFavorite}
        onDownload={onDownload}
        isFavorite={(id) => id === "p1"}
      />,
    );
    const tile1 = screen.getByTestId("tile-1");
    const fav = within(tile1).getByRole("button", {
      name: "Remove from favorites",
    });
    expect(fav.getAttribute("aria-pressed")).toBe("true");
    await user.click(fav);
    await user.click(within(tile1).getByRole("button", { name: "Download" }));
    expect(onFavorite).toHaveBeenCalledWith("p1");
    expect(onDownload).toHaveBeenCalledWith("p1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("fades the image in on load", () => {
    render(<Grid photos={photos(1)} t={t} onOpen={() => {}} />);
    const img = screen.getByRole("img");
    expect(img.className).toContain("opacity-0");
    img.dispatchEvent(new Event("load"));
  });

  it("marks the img loaded after load event", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<Grid photos={photos(1)} t={t} onOpen={() => {}} />);
    const img = screen.getByRole("img");
    fireEvent.load(img);
    expect(img.className).not.toContain("opacity-0");
  });
});
