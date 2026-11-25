import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  BulkChooseView,
  BulkProgressView,
} from "../../app/components/DownloadBulkViews";
import { t } from "./fixtures";

const progress = (over = {}) => ({
  done: 3,
  total: 8,
  failed: [] as string[],
  ...over,
});
const view = (over: Record<string, unknown> = {}) => {
  cleanup();
  const calls: string[] = [];
  const props = {
    t,
    phase: "running" as const,
    progress: progress(),
    status: "done" as const,
    fallback: null,
    confirming: false,
    setConfirming: (v: boolean) => calls.push(`confirming=${v}`),
    onAbort: () => calls.push("abort"),
    onClose: () => calls.push("close"),
    noRef: createRef<HTMLButtonElement>(),
    cancelRef: createRef<HTMLButtonElement>(),
    closeBtnRef: createRef<HTMLButtonElement>(),
    ...over,
  };
  const r = render(<BulkProgressView {...props} />);
  return { r, calls, props };
};

describe("T6.48 BulkProgressView (golden, pre-refactor)", () => {
  it("running: plain, waiting, fallback question", () => {
    expect(view().r.container.innerHTML).toMatchSnapshot("plain");
    expect(
      view({ progress: progress({ waiting: 4, total: 0 }) }).r.container
        .innerHTML,
    ).toMatchSnapshot("waiting, zero total");
    const answers: boolean[] = [];
    const v = view({
      fallback: {
        key: "download.warnLarge",
        answer: (b: boolean) => answers.push(b),
      },
    });
    expect(v.r.container.innerHTML).toMatchSnapshot("fallback");
    fireEvent.click(v.r.getByText("Continue"));
    fireEvent.click(v.r.getAllByText("Cancel")[0]);
    expect(answers).toEqual([true, false]);
  });
  it("running: cancel, confirm yes / no", () => {
    const a = view();
    fireEvent.click(a.r.getByText("Cancel"));
    expect(a.calls).toEqual(["abort"]);
    const answers: boolean[] = [];
    const b = view({
      confirming: true,
      fallback: {
        key: "download.warnLarge",
        answer: (x: boolean) => answers.push(x),
      },
    });
    expect(b.r.container.innerHTML).toMatchSnapshot("confirming");
    fireEvent.click(b.r.getByText("Yes"));
    fireEvent.click(b.r.getByText("No"));
    expect(b.calls).toEqual(["confirming=false", "abort", "confirming=false"]);
    expect(answers).toEqual([false]);
  });
  it("done / cancelled / failures", () => {
    expect(view({ phase: "done" }).r.container.innerHTML).toMatchSnapshot(
      "done",
    );
    const c = view({
      phase: "done",
      status: "cancelled",
      progress: progress({ failed: ["a", "b"] }),
    });
    expect(c.r.container.innerHTML).toMatchSnapshot("cancelled, failed");
    fireEvent.click(c.r.getByRole("button"));
    expect(c.calls).toEqual(["close"]);
  });
});

describe("T6.48 BulkChooseView (golden, pre-refactor)", () => {
  const choose = (over: Record<string, unknown> = {}) => {
    cleanup();
    const calls: string[] = [];
    const r = render(
      <BulkChooseView
        t={t}
        scopes={[
          { key: "all", label: "All photos" },
          { key: "set", label: "This set" },
        ]}
        scope="all"
        setScope={(s) => calls.push(`scope=${s}`)}
        sizes={[
          { variant: "highres", key: "download.highres" },
          { variant: "web", key: "download.web" },
        ]}
        variant="web"
        setVariant={(v) => calls.push(`variant=${v}`)}
        count={12}
        warning={null}
        error={false}
        startRef={createRef<HTMLButtonElement>()}
        disabled={false}
        onStart={() => calls.push("start")}
        {...over}
      />,
    );
    return { r, calls };
  };
  it("renders, warns, errors, disabled and reports choices", () => {
    const a = choose();
    expect(a.r.container.innerHTML).toMatchSnapshot("plain");
    fireEvent.click(a.r.getByLabelText("This set"));
    fireEvent.click(a.r.getAllByRole("radio")[2]);
    fireEvent.click(a.r.getByRole("button"));
    expect(a.calls).toEqual(["scope=set", "variant=highres", "start"]);
    expect(
      choose({ warning: "ios", error: true, disabled: true }).r.container
        .innerHTML,
    ).toMatchSnapshot("ios+error+disabled");
    expect(choose({ warning: "large" }).r.container.innerHTML).toMatchSnapshot(
      "large",
    );
  });
});
