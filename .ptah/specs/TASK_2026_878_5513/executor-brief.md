# Executor brief — TASK_2026_878_5513 (session 3, 2026-11-05)

W = /home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions (branch
fix/memory-skills-dead-actions). Every read, edit and check happens in W. Never touch the main
checkout /home/amun/ptah-extension.

## State at hand-off to you
- W was fast-forwarded to origin/main 6638ed29c. Main now owns migration `0066_review_publication`,
  so OUR migration is now **0067_indexing_last_run** (file `0067_indexing_last_run.ts`, version 67).
  Wherever batches.md / implementation-plan.md say "0066", read "0067".
- Verified green (uncommitted): Batch 9 (migration), Batch 15 (skill-synthesis).
  Batch 1+2: lint/typecheck green, tests running. Batch 10: verify running.
- Pre-existing on main, NOT ours, do not fix: `@ptah-extension/persistence-sqlite:lint` fails on
  `no-restricted-syntax` in unchanged migration files 0023-0027, 0031, 0057, 0058.
  If lint of another project fails, check whether the failing file is one you changed
  (`git diff --name-only`) before acting.

## Rules (mandatory)
- Read `batches.md` (your batches' sections, the "Rules every executor must follow" section),
  and the plan sections they cite in `implementation-plan.md` (incl. binding amendments A-F6/A-F7
  at the end). Read existing reports in `reports/` for batches yours depend on.
- Edit only the files your batches list. If a batch needs a file another batch owns, make the
  smallest additive change and name it in your report. Other executors work in W at the same time
  on other batches: never revert, reformat or "fix" files you did not change.
- Never edit: libs/backend/lane-routing/**, libs/backend/lane-outcomes/**, subagent outcome
  recording, libs/backend/platform-core/src/file-settings-manager.ts, any outcome-report.tool.ts.
- No git commands at all (no add/commit/stash/checkout/restore). The coordinator commits.
- No stubs, TODOs or placeholder logic. No raw provider text, error cause, URL, credential or host
  path in any wire result, lastRunStats, curator event or activity summary.
- Angular work: signals, standalone components, existing ptah-ui primitives; follow neighbours.
- Verify ONLY with the batch's scoped command from W:
  `npm run verify -- -p <projects> > /tmp/b878/<batch>.log 2>&1; echo EXIT $?` then filter the log
  (`sed 's/\x1b\[[0-9;]*m//g' <log> | grep -E "✖|tasks:|full log"`); full Nx logs are at the
  `full log:` path. The Bash foreground limit is 10 min: if a run is long, split it into
  `-t lint,typecheck` and `-t test` runs, or narrow with `-- --testPathPatterns=<file>` while you
  iterate, then do one final full scoped run. Never workspace-wide, never `nx run-many` on
  unlisted projects, never positional `nx test A B`, never build/serve/dev/e2e/package/bench.
  The verify lock is shared; waiting lines are normal.
- After EACH batch: write `reports/batch-<N>-report.md` (Status passed|failed|blocked, tasks,
  files created/modified with absolute paths, the exact verify command and its result lines,
  risks, decisions). Write the report before you start the next batch, so progress survives if
  you are stopped.
- Return to the coordinator: per batch status, files, verify result, open risks. Keep it short.

## Coordinator notes (session 3)
- Batch 10 verify 00:43: lint/typecheck 8/10. `ptah-electron:typecheck` failed on
  indexing-control.service.ts:327/365 (Batch 11 in progress, expected). `ptah-extension-webview:lint`
  failed "Static imports of lazy-loaded libraries" in unchanged app files (app.config.ts, app.routes.ts,
  app.ts); no new dynamic imports in our diff; PR CI on main-based branches is green. Suspect a
  project graph computed during concurrent edits. Re-run webview lint after all executors finish.
