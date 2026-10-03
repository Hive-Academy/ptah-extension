## Backend implementation — `TASK_2026_597_ab22`, batch 49

**Tasks completed**: 49.1 (lean rules section in four team-leader files)

**Files**:

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\.claude\agents\team-leader.md — added `## Lean orchestration rules` between the Operating modes table and `## Mode 1 — Decomposition` (+13 lines; `disallowedTools` frontmatter from Batch 43 untouched)
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\.codex\agents\team-leader.toml — same section inside `developer_instructions` (+13 lines; no quotes or backslashes, so no TOML escaping)
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\.opencode\agent\team-leader.md — same section (+13 lines)
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\agent-generation\templates\agents\team-leader.template.md — same section (+13 lines)

Section content reuses the wording in `.claude/skills/orchestration/references/team-leader-modes.md` § Lean orchestration rules, written from the team-leader's point of view:
fresh invocation for each Mode 2/3 call, and Mode 2 gets the batch report path and the review path, never a pasted report;
resume an executor only if its last activity was under 5 minutes ago;
decision 11 risk-based review (no review for each batch, scoped typecheck/lint/tests before commit, one code-logic review per phase on the combined diff, none for type/test/doc/measurement-only batches, a style review only for new public API);
at most one fix round.

**Stack observed**: documentation and agent text only. Mirrors are produced by `scripts/regen-agents.mjs`, which runs as a dry run unless given `--write`.

**Verification**:

- `grep -c "Lean orchestration rules"`: 1 in each of the four files
- `python -c "import tomllib; tomllib.load(...)"` on the `.codex` file: `toml ok`
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation --parallel=2`: "Successfully ran targets typecheck, test, lint" (3 tasks; the Nx Cloud 401 warning does not affect the result)
- `npx ts-node scripts/validate-orchestration-skill.ts`: 8 files checked, 0 errors, 0 warnings, VALIDATION PASSED
- `node scripts/regen-agents.mjs` (dry run): `WOULD CHANGE 0`, so the mirrors match the generator. `--write` was not needed.
- `git diff --stat`: 4 files, 52 insertions, 0 deletions. Only the section was added.

**Plan deviations**: Task 49.1's quality line says "one review per batch". I followed context.md decision 11 and the committed skill text instead (risk-based review: one code-logic review per phase), as the assignment instructed.

**Out-of-scope observations**: the existing Mode 2 text in team-leader.md still describes a review gate for every batch ("A review request..." in the modes table, and "gates it behind a code review" in the description). I left it unchanged because the batch allows only an added section. The new section sits before Mode 2 and states the rule that overrides it.
