# Agent workflow

## Roles and loop

Agent definitions live in `.claude/agents/` (source of truth — don't duplicate them here):
- `implementer` (Sonnet): one task, strict TDD.
- `adversary` (Sonnet): tries to break each task; proves findings with failing tests in `test/adversarial/`; never edits app code.
- `reviewer` (Sonnet): end-of-phase cross-task consistency review.
- `scout` (Haiku): doc lookups.

Run the **main session on Sonnet** too (`/model sonnet`). Escalate a single task to Opus only if it fails twice.

**Loop:** tests first (seen failing) → implement → refactor → adversary review → fixes with proof → lint/typecheck/test/build.

**Per task loop:**
```
implementer(task) → adversary(task, diff)
  → findings? implementer(fix: make test/adversarial/* pass) → adversary(re-check)   (max 2 rounds; then escalate to the human)
  → No findings → lint/typecheck/test/build → commit "T<x.y>: …"
```

**Orchestration prompt** (main session, once per phase):
```
Read PLAN.md §7–§9. For Phase <N>, run the per-task loop for each task, giving agents only the task ID
and diff range. Run tasks marked ∥ in parallel, the rest sequentially. After all tasks, run `reviewer`
on the phase diff, fix flagged items through the same loop, push the branch phase-<N>, open a PR,
and summarize in 5 lines.
```

Cost tips: keep `CLAUDE.md` tiny (it loads every turn); one task per subagent; `/compact` between phases.

## CLAUDE.md (keep it this short)
```markdown
# 381s-galleries
Spec and tasks: PLAN.md — read only the sections you need.
- TypeScript strict · React Router on Cloudflare Workers · Tailwind v4 · D1 + Drizzle · R2 cache · Drive API read-only.
- No image processing in code: Capture One makes every size. App never writes to Drive.
- pnpm. Strict TDD (tests first, seen failing). Before finishing: pnpm lint && pnpm typecheck && pnpm test && pnpm build.
- Every task is attacked by the `adversary` agent; its tests live in test/adversarial/.
- Never commit secrets. Never expose Drive IDs, R2 keys or tokens to clients.
```

