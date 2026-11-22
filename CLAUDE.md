# 381s-galleries
Spec and tasks: PLAN.md — read only the sections you need.
- TypeScript strict · React Router on Cloudflare Workers · Tailwind v4 · D1 + Drizzle · R2 cache · Drive API read-only.
- No image processing in code: Capture One makes every size. App never writes to Drive.
- pnpm. Strict TDD (tests first, seen failing). Before finishing: pnpm lint && pnpm typecheck && pnpm test && pnpm build.
- Refactor step after green (Fowler): small, behaviour-preserving, separate commit. Conventions: `.claude/agents/implementer.md` (Refactor conventions).
- Every task is attacked by the `adversary` agent; its tests live in test/adversarial/.
- Never commit secrets. Never expose Drive IDs, R2 keys or tokens to clients.
- Before saying a PR is ready: verify in a clean checkout (`pnpm install --frozen-lockfile`, then lint, typecheck, test, build, `pnpm check:bundles`), because a shared or symlinked `node_modules` hides missing dependencies (e.g. the esbuild binary). Browser tests bundle with vite's `build()` API, never an `esbuild` binary.
- A PR is ready only when its CI run for the pushed commit is green (`gh run list`). After each merge, rebase the other open PRs and re-check CI; check the Deploy run on main.
- Browser tests (real Chrome): use `test/support/chrome.mjs` (`launchChrome`, `until`) and `test/support/tailwind-css.mjs`; poll for conditions, never fixed sleeps; never raise a timeout to hide a failure, find the cause.
- Commits and PRs carry no tool or session attribution lines.
