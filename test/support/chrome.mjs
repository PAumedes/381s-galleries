/* global fetch */
// Launches headless Chrome for the real-browser tests (CDP).
//
// Each launch gets its own profile AND lets Chrome pick a free debugging port
// (port 0, then read it from DevToolsActivePort). Tests run in parallel and
// several of them start many Chromes: random fixed ports collided, so one
// test could talk to another test's browser or never find its own.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchChrome() {
  const dir = mkdtempSync(join(tmpdir(), "chrome-"));
  const ch = spawn(
    "google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--remote-debugging-port=0",
      `--user-data-dir=${dir}`,
      "--no-first-run",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const file = join(dir, "DevToolsActivePort");
  for (let i = 0; i < 300; i++) {
    if (existsSync(file)) {
      const port = Number(readFileSync(file, "utf8").split("\n")[0]);
      if (port) {
        try {
          const list = await (
            await fetch(`http://127.0.0.1:${port}/json`)
          ).json();
          return { ch, port, list };
        } catch {
          // Port written but not serving yet: keep polling.
        }
      }
    }
    await sleep(100);
  }
  ch.kill();
  throw new Error("Chrome did not open its debugging port in 30 s");
}
