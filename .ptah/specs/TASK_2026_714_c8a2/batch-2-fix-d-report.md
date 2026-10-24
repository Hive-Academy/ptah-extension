# Batch 2-fix-d report

Task: TASK_2026_714_c8a2. Implemented N1–N4 and F-A in the six assigned source/spec files only. No git operations, dependency installation, build, real Codex binary, or other lane source edits.

## Changes and regression evidence

Paths below are relative to `libs/backend/codex-runtime/src/lib/`.

- **N1:** `codex-runtime.ts:389` refreshes the compaction watchdog for item/turn activity on the owned thread while compaction reserves admission. `codex-runtime.ts:667` starts a fresh 30-second quiet period; completion, rejection and close clear it. `codex-runtime.spec.ts:680` proves 100 seconds of active compaction survives and completion clears the watchdog. `:712` proves silence after activity fails and another thread cannot extend the deadline. Existing `:558` covers completely silent compaction and interruption waits.
- **N2:** `codex-runtime.ts:218` captures the approval turn identity and emits sanitized `codexFollowUpRejected` on RPC rejection without closing the healthy turn. The decline remains already sent. `codex-runtime.spec.ts:414` proves one decline precedes steer, a fixed error event is delivered, retry works, and the turn emits one completion terminal.
- **N3:** `codex-permission-policy.ts:21` checks file grantRoot and unknown fields before remembered-rule approval for ask, auto-edit and yolo; plan still declines effects before rules. `codex-permission-policy.spec.ts:55` covers widening details with/without remembered rules across those levels, including ask + grantRoot. `:66` preserves auto-edit's requirement for details. The existing rule-store spec verifies the optional-details policy API remains compatible.
- **N4:** `codex-app-server-process.ts:161` installs a capture-free permanent no-op child error listener. Cleanup removes operational listeners but leaves this listener for late child errors, without retaining the runtime through its callback. `codex-app-server-process.spec.ts:409` proves errors after the one-second kill ceiling do not throw, operational listeners are released and no timer remains. Crash cleanup and runtime teardown assertions also exercise late errors.
- **F-A:** `codex-app-server-process.ts:187` uses `normalizeCodexHomeKey` for both handshake homes and translates invalid/mismatched paths into sanitized `CodexHomeMismatchError`. Existing `codex-app-server-process.spec.ts:265` and `:295` pass unchanged, proving lexical path normalization and Windows case/separator equivalence retain their results.

## Verification

Commands ran from the assigned worktree. PowerShell `Select-Object -Last` and `Select-String` implement the requested tail/grep filtering.

```powershell
npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts libs/backend/codex-runtime/src/lib/codex-permission-policy.spec.ts libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20
npx nx run-many -t test typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static 2>&1 | Tee-Object -FilePath "$env:TEMP/ptah-batch-2-fix-d-final.log" | Select-String 'Tests:|problems|Successfully|Failed| error ' | Select-Object -Last 10
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String 'codex-runtime|TOTAL'
npx prettier --write libs/backend/codex-runtime/src/lib/codex-runtime.ts libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts libs/backend/codex-runtime/src/lib/codex-permission-policy.ts libs/backend/codex-runtime/src/lib/codex-permission-policy.spec.ts libs/backend/codex-runtime/src/lib/codex-app-server-process.ts libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts
```

- Final focused Jest: **3 suites, 78 tests passed**.
- Final Nx: **707 tests passed; test, typecheck and lint successfully completed**. Lint: **0 errors, 8 warnings**. Final full log retained in the operating-system temporary directory above.
- Scoped `ptah_get_diagnostics` after final source changes: **0 errors, 0 warnings**, clean coverage.
- Degradation audit: **TOTAL 276 unsuppressed sites**, no codex-runtime output or FAIL.
- Prettier ran on all six owned files and again after subsequent edits. Its multiline computed iterator expression was restructured to satisfy ESLint.
- Initial checks exposed obsolete zero-error-listener assertions and an optional-details rule-store compatibility expectation; these were fixed before the passing final checks.
- **Remaining verification caveat:** the full Nx Jest run emitted a worker force-exit warning, plus Node's Jest configuration ES-module loading warning. Focused suites passed without the worker warning. No extra handle-detection run was performed under the requested verification-only scope. The worker warning remains unresolved, not represented as a clean handle audit.

## Decisions

1. **Quiet-period watchdog, not a longer fixed deadline.** Options: raise a total timeout or reset on activity. Evidence: N1, serialized compaction admission, and existing item/turn notifications. Chosen: 30 seconds of silence, refreshed only by matching-thread item/turn notifications. Reversible local implementation; silent model work longer than 30 seconds still times out as requested by the quiet-period option.
2. **Non-terminal follow-up rejection.** Options: close the context or surface a fixed error event. Evidence: typed RPC rejection already leaves ordinary steer usable, and the decline has been sent. Chosen: sanitized event with captured turn identity, leaving terminal handling to existing turn notifications. Reversible; no remote text exposed.
3. **Scope checks at every effect-capable level.** Options: ask/auto-edit only or all levels. Evidence: the current batch explicitly says every level. Chosen: widening details prompt even in yolo; plan retains its stronger decline rule. Preserve omitted-details compatibility outside auto-edit, evidenced by the rule-store API's existing spec; real bridge requests supply parsed details. Reversible local policy change within the approved fix.
4. **Capture-free permanent child listener.** Options: retain the operational closure or install a no-op listener. Evidence: N4 requires lifetime coverage after bounded cleanup. Chosen: one no-op callback, avoiding runtime retention and secret logging. Reversible; operational listeners and timers still release.
5. **Shared canonicalizer with typed sanitized failure.** Options: duplicate normalization or call the existing helper. Evidence: F-A and existing Windows/POSIX handshake specs. Chosen: shared helper, preserving mismatch error classification even when normalization rejects invalid input. Reversible and no new abstraction.

Repository evidence: root CLAUDE.md constrains verification; implementation-plan.md defines one runtime and isolated contexts; existing runtime, policy, process and colocated specs define the operation queue, approval ordering, typed RPC failures, fake children and timer-test patterns. The newer explicit batch assignment controls this follow-up scope.
