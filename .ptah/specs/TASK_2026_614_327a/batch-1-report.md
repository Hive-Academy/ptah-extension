# Batch 1 report (TASK_2026_614_327a)

All paths under `D:/projects/ptah-extension/.claude-worktrees/task-614-d-e/`.

## Changed files

- `libs/backend/agent-sdk/src/lib/helpers/compaction/tool-output-capper.ts` (Task 1.1, D.1): whole-file Read outline now sets
  `file.startLine = 1` and `file.numLines` = line count of the returned text, only when the response already had those keys;
  `totalLines` unchanged. Trailer now reads "line positions in this outline are not file line numbers; read with offset/limit
  for exact lines". Partial-read path (`capSlots`) untouched.
- `.../compaction/tool-output-capper.spec.ts`: existing whole-file test updated (numLines = outline lines, startLine 1,
  totalLines 300, "not file line numbers" text); new test that a response lacking the fields gains none.
- `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts` (Task 1.2, D.9 N2 / A-m7): the `as number` cast is
  replaced by `budgetDefault()` (guard `Number.isSafeInteger && > 0`, throws on a bad platform-core default); invalid
  hand-edited values warn once per key+type+value via a private `Set`.
- `.../compaction-config-provider.spec.ts`: pins all four keys positive-safe-integer in `FILE_BASED_SETTINGS_DEFAULTS`;
  three `getConfig()` calls with one invalid value log one warn.
- `libs/backend/tool-output-reducers/src/lib/output-budget/spool.ts` (Task 1.3, D.9 N3): `ensureSpoolGitignore` ignores
  `EEXIST`, returns the errno code or error name otherwise; `SpoolOutcome` path variant gets optional `gitignoreFailure`
  (fail-open, spool file still written, no message text). Comment now matches behaviour.
- `.../output-budget/apply-output-budget.ts`: the existing `logLine` route reports `gitignoreFailure` once per spool write.
- `.../output-budget/spool.spec.ts`: EACCES on `.gitignore` -> `gitignoreFailure: 'EACCES'`, file written, no message leak;
  EEXIST case asserts no `gitignoreFailure`.

Note: other `spoolToolText` callers (vscode-lm-tools dispatcher) receive `gitignoreFailure` but do not log it; out of scope.

## Checks (all exit 0)

- `npx nx run-many -t typecheck,lint,test -p agent-sdk,tool-output-reducers` -> exit 0 (6/6 tasks)
- `npx nx run di-lint:lint` -> exit 0
- `npx nx run degradation-audit:lint` -> exit 0 (no findings in the changed files)
