import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import {
  SetupView,
  type SetupViewData,
} from "../../app/components/admin/SetupView";
import { BuildInfo } from "../../app/components/admin/BuildInfo";

const base: SetupViewData = {
  connected: false,
  mock: false,
  rootName: null,
  studioName: "381 Studios",
  lastSyncAt: null,
  lastError: null,
};

describe("T6.29 settings build footer", () => {
  it("SetupView ends with the build identifier (es)", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin/setup",
        Component: () => <SetupView data={base} actionData={undefined} />,
      },
    ]);
    render(<Stub initialEntries={["/admin/setup"]} />);
    const el = await screen.findByTestId("build-id");
    expect(el.textContent).toMatch(/^Versión: dev/);
  });
  it("shows sha and date", () => {
    render(<BuildInfo sha="abc1234" date="2026-11-20" />);
    expect(screen.getByTestId("build-id").textContent).toBe(
      "Versión: abc1234 · 2026-11-20",
    );
  });
});
