# 381s-galleries
Spec and tasks: PLAN.md — read only the sections you need.
- TypeScript strict · React Router on Cloudflare Workers · Tailwind v4 · D1 + Drizzle · R2 cache · Drive API read-only.
- No image processing in code: Capture One makes every size. App never writes to Drive.
- pnpm. Strict TDD (tests first, seen failing). Before finishing: pnpm lint && pnpm typecheck && pnpm test && pnpm build.
- Refactor step after green (Fowler): small, behaviour-preserving, separate commit. Conventions: `.claude/agents/implementer.md` (Refactor conventions).
- Every task is attacked by the `adversary` agent; its tests live in test/adversarial/.
- Never commit secrets. Never expose Drive IDs, R2 keys or tokens to clients.
