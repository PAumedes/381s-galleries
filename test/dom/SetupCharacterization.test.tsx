import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import {
  SetupView,
  type SetupActionData,
  type SetupViewData,
} from "../../app/components/admin/SetupView";

/**
 * Characterization of the setup page: a DOM snapshot per state so the view can
 * be split into section components with byte-identical markup.
 */

const full: SetupViewData = {
  connected: true,
  mock: false,
  rootName: "Mi Carpeta",
  studioName: "381 Studios",
  lastSyncAt: "2026-11-01T12:00:00Z",
  cacheWarm: { warmed: 3, total: 10 },
  logo: { onLight: "v1", onDark: null },
  lastError: { at: "2026-11-02T08:00:00Z", message: "boom" },
  ignoredFolders: [
    { handle: "h1", deletedAt: "2026-10-01T00:00:00Z" },
    { handle: "h2", deletedAt: "2026-10-02T00:00:00Z" },
  ],
};
const empty: SetupViewData = {
  connected: false,
  mock: true,
  rootName: null,
  studioName: "X",
  lastSyncAt: null,
  lastError: null,
};
const synced: SetupActionData = {
  intent: "sync",
  ok: true,
  result: {
    galleries: { created: 1, updated: 2, archived: 3 },
    photos: { added: 4, updated: 5, removed: 6 },
    issues: 7,
  },
};

async function html(data: SetupViewData, actionData?: SetupActionData) {
  const Stub = createRoutesStub([
    {
      path: "/admin/setup",
      Component: () => <SetupView data={data} actionData={actionData} />,
    },
  ]);
  const { container } = render(<Stub initialEntries={["/admin/setup"]} />);
  await screen.findByRole("heading", { level: 1 });
  return container.innerHTML.replace(/blob:[^"]+/g, "blob:X");
}

describe("SetupView characterization (T6.47)", () => {
  it("connected, everything populated + sync summary", async () => {
    expect(await html(full, synced)).toMatchSnapshot();
  });
  it("demo / empty state", async () => {
    expect(await html(empty)).toMatchSnapshot();
  });
  it("error feedback", async () => {
    expect(
      await html(full, { intent: "root", ok: false, error: "bad" }),
    ).toMatchSnapshot();
  });
  it("skipped sync", async () => {
    expect(
      await html(full, {
        ...synced,
        result: { ...synced.result!, skipped: "locked" },
      }),
    ).toMatchSnapshot();
  });
});
