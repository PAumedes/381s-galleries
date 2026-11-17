import { expect, it } from "vitest";
import { downloadBulk } from "../../app/lib/download-client";

it("cancelling while waiting out a 429 Retry-After ends the run promptly", async () => {
  const ctl = new AbortController();
  let sleeping: () => void = () => {};
  const started = new Promise<void>((r) => (sleeping = r));
  const fetch = async () =>
    new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "Retry-After": "60", "Content-Type": "application/json" },
    });
  const run = downloadBulk({
    slug: "s",
    scope: "all",
    variant: "web",
    signal: ctl.signal,
    deps: {
      fetch: fetch as never,
      saveBlob: () => {},
      // a real timer-based sleep: it cannot be interrupted by the signal
      sleep: () => {
        sleeping();
        return new Promise<void>((r) => setTimeout(r, 3000));
      },
    },
  }).then(
    () => "settled",
    () => "settled",
  );
  await started;
  ctl.abort();
  const winner = await Promise.race([
    run,
    new Promise((r) => setTimeout(() => r("hung"), 300)),
  ]);
  expect(winner).toBe("settled");
});
