import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const repo = process.cwd();
const read = (p) => readFileSync(path.join(repo, p), "utf8");
const CI = ".github/workflows/ci.yml";
const DEP = ".github/workflows/deploy.yml";

/** Run the structural guard tests against mutated copies of the workflows. */
function guardsPass(mutate) {
  const dir = mkdtempSync(path.join(tmpdir(), "shard-mut-"));
  mkdirSync(path.join(dir, ".github/workflows"), { recursive: true });
  mkdirSync(path.join(dir, ".github/actions/setup"), { recursive: true });
  mkdirSync(path.join(dir, "t"), { recursive: true });
  const files = {
    [DEP]: read(DEP),
    [CI]: read(CI),
    ".github/workflows/setup.yml": read(".github/workflows/setup.yml"),
    ".github/actions/setup/action.yml": read(
      ".github/actions/setup/action.yml",
    ),
  };
  mutate(files);
  for (const [p, c] of Object.entries(files))
    writeFileSync(path.join(dir, p), c);
  for (const t of [
    "test/scripts/deploy-workflow.test.mjs",
    "test/scripts/adversarial/T6-workflow-hardening.test.mjs",
  ])
    cpSync(path.join(repo, t), path.join(dir, "t", path.basename(t)));
  symlinkSync(path.join(repo, "node_modules"), path.join(dir, "node_modules"));
  writeFileSync(
    path.join(dir, "vitest.config.mjs"),
    'export default { test: { include: ["t/*.test.mjs"] } };\n',
  );
  const r = spawnSync(
    path.join(repo, "node_modules/.bin/vitest"),
    ["run", "--root", dir],
    {
      cwd: dir,
      encoding: "utf8",
    },
  );
  return r.status === 0;
}

const sub = (f, file, from, to) => {
  if (!f[file].includes(from))
    throw new Error(`mutation anchor missing: ${from}`);
  f[file] = f[file].replace(from, to);
};

const cases = {
  "baseline-sanity: matrix [1..4] with /5 (should be caught)": null,
  "ci.yml test job continue-on-error": (f) =>
    sub(
      f,
      CI,
      "    name: test (${{ matrix.shard }}/5)\n",
      "    name: test (${{ matrix.shard }}/5)\n    continue-on-error: true\n",
    ),
  "ci.yml test job if: false (all shards skipped)": (f) =>
    sub(
      f,
      CI,
      "    name: test (${{ matrix.shard }}/5)\n",
      "    name: test (${{ matrix.shard }}/5)\n    if: false\n",
    ),
  "ci.yml test job fail-fast true": (f) =>
    sub(f, CI, "fail-fast: false", "fail-fast: true"),
  "ci.yml matrix exclude shard 3": (f) =>
    sub(
      f,
      CI,
      "        shard: [1, 2, 3, 4, 5]\n",
      "        shard: [1, 2, 3, 4, 5]\n        exclude:\n          - shard: 3\n",
    ),
  "deploy.yml matrix exclude shard 3": (f) =>
    sub(
      f,
      DEP,
      "        shard: [1, 2, 3, 4, 5]\n",
      "        shard: [1, 2, 3, 4, 5]\n        exclude:\n          - shard: 3\n",
    ),
  "ci.yml check needs drops test": (f) =>
    sub(
      f,
      CI,
      "needs: [lint, typecheck, build, test]",
      "needs: [lint, typecheck, build]",
    ),
  "ci.yml check loses if: always()": (f) =>
    sub(f, CI, "    if: always()\n", ""),
  "ci.yml check accepts skipped": (f) =>
    sub(
      f,
      CI,
      'if [ "$r" != "success" ]; then',
      'if [ "$r" = "failure" ]; then',
    ),
  "ci.yml check job renamed (branch protection name)": (f) =>
    sub(f, CI, "\n  check:\n", "\n  gate:\n"),
  "ci.yml shard flag removed (runs every file in every job)": (f) =>
    sub(f, CI, "vitest run --shard=${{ matrix.shard }}/5", "vitest run"),
  "ci.yml matrix swapped to a comment-decoy": (f) =>
    sub(
      f,
      CI,
      "        shard: [1, 2, 3, 4, 5]\n",
      "        # shard: [1, 2, 3, 4, 5]\n        shard: [1, 2, 3, 4]\n",
    ),
  "deploy.yml shard flag commented out and decoy echo": (f) =>
    sub(
      f,
      DEP,
      "      - run: pnpm exec vitest run --shard=${{ matrix.shard }}/5\n",
      "      # --shard=${{ matrix.shard }}/5\n      - run: pnpm exec vitest run --shard=1/5\n",
    ),
  "deploy.yml matrix include adds duplicate shard 1": (f) =>
    sub(
      f,
      DEP,
      "        shard: [1, 2, 3, 4, 5]\n",
      "        shard: [1, 2, 3, 4, 5]\n        include:\n          - shard: 1\n",
    ),
  "ci.yml test job gets pull_request-only skip via if on step": (f) =>
    sub(
      f,
      CI,
      "      - run: pnpm exec vitest run --shard=${{ matrix.shard }}/5",
      "      - if: matrix.shard != 5\n        run: pnpm exec vitest run --shard=${{ matrix.shard }}/5",
    ),
  "deploy.yml step-level if skips vitest on shard 5": (f) =>
    sub(
      f,
      DEP,
      "      - run: pnpm exec vitest run --shard=${{ matrix.shard }}/5",
      "      - if: matrix.shard != 5\n        run: pnpm exec vitest run --shard=${{ matrix.shard }}/5",
    ),
  "ci.yml job-level fail via || true on vitest": (f) =>
    sub(
      f,
      CI,
      "vitest run --shard=${{ matrix.shard }}/5",
      "vitest run --shard=${{ matrix.shard }}/5 || true",
    ),
  "ci.yml test needs lint (serialises, not parallel) / extra job removed": (
    f,
  ) =>
    sub(f, CI, "  typecheck:\n", "  typecheck:\n    continue-on-error: true\n"),
};
delete cases["baseline-sanity: matrix [1..4] with /5 (should be caught)"];

describe("shard plan guards must catch silent shard drop-outs", () => {
  it("baseline passes", () => expect(guardsPass(() => {})).toBe(true));
  for (const [name, mutate] of Object.entries(cases))
    it(`catches: ${name}`, () => {
      expect(guardsPass(mutate), "mutation survived").toBe(false);
    });
  it("control: matrix 1..4 with /5 is caught", () =>
    expect(
      guardsPass((f) => sub(f, DEP, "[1, 2, 3, 4, 5]", "[1, 2, 3, 4]")),
    ).toBe(false));
  it("control: flag /4 with matrix 1..5 is caught", () =>
    expect(
      guardsPass((f) =>
        sub(
          f,
          CI,
          "--shard=${{ matrix.shard }}/5",
          "--shard=${{ matrix.shard }}/4",
        ),
      ),
    ).toBe(false));
});
