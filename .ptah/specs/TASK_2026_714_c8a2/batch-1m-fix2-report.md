# Batch 1m-fix2 report

Implemented offline in `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`. No paid turns, real Codex binary execution, git operations, src changes, other-library changes, or spike-runner plan edits.

## Differences found

- `evidence-cases-round.ts` already imported and used the main harness's exported `markerCommand`. There was no remaining duplicate command builder to replace. Both pass `[process.execPath, script, experiment.root, marker]`. The shared builder normalizes Windows paths to forward slashes and quotes each argument (`evidence-harness.ts:1158`). This retains the correction motivated by native-route-evidence.md rows 6b�6e (PowerShell wrapper, doubled backslashes, trailing punctuation).
- The old round developer text began �Only execute the exact commands requested� and ended �Otherwise reply OK without tools.� It omitted the proven marker-only wording and one-action instruction.
- The old round prompt began �Request approval then run exactly the following command once� and put �No other tools or retries� before the command. The accept case instead puts the command on its own line, explicitly forbids added punctuation, and ends with �No other tools or retries.�
- Round command/identity rejections threw without a shape note. Bounded sanitized agent messages were already captured by `RpcChild.event` (`evidence-harness.ts:680`), with three messages maximum and 400 characters each; the round child already supplies `createPathRedactor(local, authDirectory)`.

## Changes and evidence

All source paths below are relative to `libs/backend/codex-runtime/tools/`.

- `evidence-harness.ts:1149`: exported `MARKER_INSTRUCTIONS`, `MARKER_MESSAGE_INSTRUCTIONS`, and `commandPrompt`. Main accept/edit paths consume those shared definitions at lines 2048�2065. The existing command builder remains shared, unchanged in behavior. Read-only command prompts retain their existing �Run� prefix.
- `evidence-cases-round.ts:226`: rejection diagnostics reuse `recordCommandShape` from `evidence-failure-notes.ts`, including its sanitization, path/script placeholders, difference classification, and bounds. Approval rejection paths and notification identity mismatch record observed fields before rejection; unexpected command items do so at line 354. The outer catch at line 554 supplies an explicit missing-command shape for identity gates that have no command payload. Approval matching and fail-closed behavior remain unchanged.
- `evidence-cases-round.ts:431`: command cases consume the shared developer instructions, using the per-user-message variant for same-home and always-allow. Lines 502�523 use the shared prompt for initial commands, the same-home step, and both requested commands in the existing always-allow second turn.
- `evidence-cases-round.spec.ts:429`: fake-child checks cover identical shared command/prompt/instruction generation, forward-slash Windows paths, same-home second steps, and both always-allow second-turn commands.
- `evidence-cases-round.spec.ts:489`: regression coverage injects an unexpected command before approval, cross-thread notifications, cross-thread approvals, and wrong-command approvals. It verifies sanitized shape notes, bounded sanitized agent text, absence of real experiment/user paths and bearer secrets, and cleanup. No real child executable runs in these specs.

## Verification

PowerShell `Select-Object` / `Select-String` were used as equivalents of the requested tail/head/grep filters.

1. `npx prettier --write libs/backend/codex-runtime/tools/evidence-cases-round.ts libs/backend/codex-runtime/tools/evidence-cases-round.spec.ts libs/backend/codex-runtime/tools/evidence-harness.ts` � passed; the spec was formatted again after correcting its assertion.
2. Scoped `ptah_get_diagnostics` on the three changed files � clean, zero errors/warnings. Repeated on the spec after the assertion adjustment � clean.
3. `npx jest -c libs/backend/codex-runtime/jest.config.ts --testPathPatterns=tools --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 15` � final exit 0, 3 suites passed, 233 tests passed. Initial run: 231 passed / 2 failed because the new assertion incorrectly required every retained agent message to contain the injected bearer text; fake children can append �OK� after a declined request. Corrected to bound every message, require a redacted sensitive message, and prohibit unredacted secrets across diagnostics. Jest reported an ES-module configuration warning, skipped a symlink check because Windows forbids creation, and reported a worker forced to exit after teardown. No broader investigation/check was run.
4. `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static 2>&1 | Select-String 'problems|Successfully|Failed| error ' | Select-Object -Last 8` � exit 0; both targets succeeded, 0 errors / 8 warnings. Procedural caveat: this first Nx run briefly overlapped the initial Jest run after its session was incorrectly treated as finished. Subsequent verification was sequential.
5. `$dryOutput = npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json .ptah/specs/TASK_2026_714_c8a2/spike-runner.ts --dry-run --round 7a 2>&1; $dryExit = $LASTEXITCODE; $dryOutput | Select-Object -First 3; exit $dryExit` � exit 0; six cases, five planned turns, cap six, estimated 72000 tokens, prior turns zero. The first direct `Select-Object -First 3` pipeline ended its producer early (exit -1); collecting output before filtering fixed that verification issue. Both invocations were dry runs.
6. `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String 'FAIL|TOTAL'` � exit 0; TOTAL 276 unsuppressed sites, no FAIL output.

## Decisions

- Reuse the already-shared marker builder rather than add another wrapper or duplicate implementation. Options: existing builder or new builder. Evidence: both modules already call `markerCommand` with the same argument structure. Reversible: yes.
- Export the proven texts from the main harness rather than create a new module. Options: harness exports or separate shared module. Evidence: existing round imports already depend on the harness and scope explicitly permits exporting builders/constants there. Reversible: yes.
- Reuse existing `RpcChild` agent-message capture instead of implementing another buffer. Options: inherited bounded capture or duplicate round capture. Evidence: `evidence-harness.ts:680�695` and the new rejection specs. Reversible: yes.
- Preserve the existing two-turn always-allow experiment and its three-command assertions pending orchestration guidance. Options: retain plan or split into three turns. Evidence: round code requests the first command once in turn one, then reuses that command and requests a different command in turn two; the task prohibits changing spike-runner plans. Reversible: yes. This leaves the instruction conflict below unresolved and is not a claim of paid-run readiness.

## Clarifications Needed

The existing always-allow second turn requests two tool actions, while the required shared developer instruction and each command prompt permit one. Changing the two-turn plan or dropping the reuse observation is outside this fix's authorization. Before a paid run, the coordinator must resolve this:

1. Split reuse and changed-command probes into separate user messages and update the authorized turn plan/budget (Recommended); or
2. Explicitly authorize a scope-specific multi-action instruction while retaining the current two-turn probe.

No paid verification was attempted; the cause of the historical run 7a command mismatch remains unknown because that artifact did not retain its observed shape.
