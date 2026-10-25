# Batch 1m-fix3 report

Implemented the bounded correction in `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`. No paid turns, real binary execution, `--run`, git operations, or production src changes. The existing spike-runner consumes the corrected plan without changes.

## Changes and specs

All source paths below are relative to `libs/backend/codex-runtime/tools/`.

- `evidence-cases-round.ts:529`: always-allow now sends three separate shared command prompts: initial marker, identical marker, different marker. It checks one approval/two completed commands before starting the third message. Shared proven instructions, marker builder, prompts, and redacted command-shape diagnostics from fix2 remain intact.
- `evidence-cases-round.ts:260`, `:292`, `:361`: the changed-command approval requires completed reuse, receives `decline`, and must finish with a declined item and absent marker. The final check at `:540` requires two approvals and three command items, with the third declined. Evidence records `exactCommandReuseWithoutApproval` and `differentCommandDeclined`.
- `evidence-cases-round.spec.ts:140`, `:260`, `:368`, `:426`, `:479`: fake child models one command per message, same-command reuse without a prompt, and a changed-command prompt answered decline. Assertions cover three turns, exact per-message text, decisions, cleanup, and rejection if a declined command creates its marker. Existing invalid-approval fixture streams are preserved.
- `evidence-cases.json:149`: always-allow turnCost is 3.
- `evidence-round-plan.ts:3`: explicit approval ledger is 35 total minus 18 earlier turns minus one failed first 7a turn, leaving 16. The existing `--7a-turns-used` flag subtracts subsequent rerun usage only. The scope estimate at `:14` is explicitly three times 12,000 tokens.
- `evidence-harness.ts:44`: maximum approved cap is 16, aligned with the remaining allowance. `evidence-harness.spec.ts:2814` updates the catalog total to ten paid turns across both rounds.
- `evidence-round-plan.spec.ts:45`, `:86`: rejects caps beyond 16 and combined prior/current caps beyond 16; plan assertions read the actual JSON catalog and verify both turn counts, caps, estimates, and remaining balances.

## Final plan

Both rounds retain the three schema-only probes (zero turns, zero estimated tokens).

| Round | Paid cases in order (turns)                                                   | Planned turns | Cap | Estimated tokens |              Budget before run |
| ----- | ----------------------------------------------------------------------------- | ------------: | --: | ---------------: | -----------------------------: |
| 7a    | different-home-isolation (1), always-allow-scope (3), same-home-isolation (2) |             6 |   7 |           72,000 |                             16 |
| 7b    | resume-history (2), profile-inputs (1), usage-semantics (1)                   |             4 |   5 |           64,000 | 9 with hypothetical 7a usage 7 |

The estimator totals 12,000 + 36,000 + 24,000 = 72,000 for 7a and 24,000 + 15,000 + 25,000 = 64,000 for 7b. Each is below 85,000; the existing spec also verifies each estimate plus a 12,000-token reserve remains below 85,000.

## Budget ledger

Approved total: 35. Earlier use: 18. Failed first 7a use: 1 (decisions.md:152). Already used: 19. Remaining: 16. Proposed caps: 7 + 5 = 12 <= 16, leaving four turns outside those caps. Actual paid use during this correction: zero. The dry-run flag value 7 models a full subsequent 7a cap, not actual spending. For any real 7b invocation, supply the reconciled actual subsequent 7a usage from its artifact; the failed first attempt is already included in the fixed baseline.

## Verification

PowerShell equivalents of tail/head/grep were used. Exit codes were retained. No workspace-wide tests, build, serve, dev, or e2e were run.

1. Scoped diagnostics after edits: `ptah_get_diagnostics` on changed TypeScript files, then again on the final round implementation/spec: zero errors and warnings, clean coverage.
2. Scoped Jest (final exit 0):

```powershell
npx jest -c libs/backend/codex-runtime/jest.config.ts --testPathPatterns=tools --coverage=false --maxWorkers=2 2>&1 | Tee-Object -FilePath $env:TEMP/ptah-fix3-jest.txt | Select-Object -Last 15; exit $LASTEXITCODE
```

Final result: 3 suites passed; 235 tests passed. Runtime 24.337 seconds. Warnings remain: Jest config ES-module loading, OS-forbidden symlink case skipped internally, and a worker forcibly exited after failing graceful shutdown. Two earlier runs failed (4, then 1 tests): the fake child's decline handling initially altered invalid-approval fixtures; the final new regression also expected error text that protocol sanitization hid. Fixture behavior was corrected and the established safe gate-error text reused. No real child binary ran.

3. Final scoped Nx (exit 0):

```powershell
npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static 2>&1 | Select-String 'problems|Successfully|Failed| error ' | Select-Object -Last 8; exit $LASTEXITCODE
```

`8 problems (0 errors, 8 warnings)`; `Successfully ran targets typecheck, lint for project @ptah-extension/codex-runtime`. Preserve-caught-error warnings remain. Scheduling deviation: the final Nx command started while the final Jest session still reported running; both completed successfully, but this did not meet the requested one-heavy-check-at-a-time constraint.

4. Dry runs (both exit 0), collecting output before taking the first three lines to avoid the known broken-pipe issue:

```powershell
$dryOutput = npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json .ptah/specs/TASK_2026_714_c8a2/spike-runner.ts --dry-run --round 7a 2>&1; $dryExit = $LASTEXITCODE; $dryOutput | Select-Object -First 3; Write-Output "7a exit $dryExit"
$dryOutput = npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json .ptah/specs/TASK_2026_714_c8a2/spike-runner.ts --dry-run --round 7b --7a-turns-used 7 2>&1; $dryExit = $LASTEXITCODE; $dryOutput | Select-Object -First 3; Write-Output "7b exit $dryExit"
```

Exact headers:

```text
runner 7a: 6 cases, planned turns 6, cap 7, estimated tokens 72000, budget left 16, prior turns used 0
{
  "mode": "dry-run",
runner 7b: 6 cases, planned turns 4, cap 5, estimated tokens 64000, budget left 9, prior turns used 7
{
  "mode": "dry-run",
```

5. Degradation audit (exit 0):

```powershell
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String 'FAIL|TOTAL'; exit $LASTEXITCODE
```

`degradation-audit: TOTAL 276 unsuppressed site(s)`; no FAIL output.

6. Prettier applied to all seven changed source/catalog/spec files and this report:

```powershell
npx prettier --write libs/backend/codex-runtime/tools/evidence-cases-round.ts libs/backend/codex-runtime/tools/evidence-cases-round.spec.ts libs/backend/codex-runtime/tools/evidence-cases.json libs/backend/codex-runtime/tools/evidence-round-plan.ts libs/backend/codex-runtime/tools/evidence-round-plan.spec.ts libs/backend/codex-runtime/tools/evidence-harness.ts libs/backend/codex-runtime/tools/evidence-harness.spec.ts .ptah/specs/TASK_2026_714_c8a2/batch-1m-fix3-report.md
```

## Decisions

- Use a fixed explicit ledger rather than add `--prior-turns-used`. Evidence: decisions.md:148 approves 35 total; :152 records 19 spent; the current instruction confirms that ledger. Existing `--7a-turns-used` already handles subsequent round usage. This keeps the failed turn non-overridable and avoids a second accounting argument. Reversible by an explicitly authorized ledger update.
- Keep the 36,000 scope estimate, expressed as 3 x 12,000. Options were keeping the established estimate or increasing it speculatively. The existing estimate already provides 12,000 per action after the split, consistent with the different-home and same-home estimates. Reversible when new observed evidence warrants recalibration; no observed usage is claimed.
- Require a declined command item and absence of its marker. Evidence: the main harness recognizes the pinned protocol's `declined` status; the orchestrator explicitly requires decline on the third action. Do not treat a successful execution as a successful scope observation. Reversible only with a changed evidence contract.
- Keep the task runner unchanged: its existing plan import and explicit subsequent-7a-use argument already propagate the corrected ledger, cap, and totals. No new abstraction or alternate runner is needed.

No unresolved implementation decision remains. Paid behavior is unverified by design; the historical command mismatch cause remains unknown.
