# Batch 26 report

## Files changed
- libs/backend/tool-output-reducers/src/lib/output-budget/spool.ts: Task 26.1. `ensureSpoolGitignore` returns a non-EEXIST failure once per directory (new bounded `reportedGitignoreFailureDirs` set, helper `markGitignoreFailureReported`). Later calls for that directory return undefined, so the engine's existing log in apply-output-budget.ts:190 fires once. Successes are not cached, so a deleted and recreated directory still gets its `.gitignore`.
- libs/backend/tool-output-reducers/src/lib/output-budget/spool.spec.ts: the second spool into the same failing directory carries no `gitignoreFailure`.
- libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.spec.ts: Task 26.2 spec. Two budgeted calls with an unwritable `.gitignore` produce one log line with the code and no path.
- libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts: Task 26.3. The `waitFor` JSDoc lists the cancellation throw.

## Task 26.2 note
No dispatcher source change was needed. Both dispatchers (protocol-dispatcher.ts:3358 and agent-tool.dispatcher.ts:323) already pass `budgetOutputChannel(logger)`, which logs at `warn`. The engine writes the `.gitignore` line to that channel. `OutputBudgetOutcome` does not expose `gitignoreFailure`. Once-per-directory comes from 26.1. I did not touch protocol-dispatcher.ts.

## Checks
- `nx run-many -t typecheck,lint,test -p tool-output-reducers vscode-lm-tools`: exit 0, all 6 targets passed. I re-ran tool-output-reducers after a refactor: exit 0.
- `nx run di-lint:lint`: exit 0.
- `nx run degradation-audit:lint`: my first version failed (spool.ts catch returned a literal; tool-output-reducers 1 FAIL against baseline 0). I fixed it with the ternary and helper. A rerun shows no tool-output-reducers entries. I only grepped for those entries and did not capture the overall exit code of that rerun.

## Open notes
None.
