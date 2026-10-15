# Batch 20 report

## Task 20.1

- `libs/backend/agent-generation/src/lib/services/analysis-fingerprint.ts:9-107`: moved the fingerprint constants, length-prefixed hashing, and workspace fingerprint algorithm without changing the digest; added `sha256Hex` and `hashFileOrNull`. The latter returns null for missing or unreadable files so callers treat them as hash mismatches.
- `libs/backend/agent-generation/src/lib/services/wizard/analysis-run-checkpoint.ts:7`: changed only the fingerprint import path.

## Task 20.2

- `libs/backend/agent-generation/src/lib/services/analysis-freshness.service.ts:39-204`: injected Logger, split run discovery and qualification, derived phases from `PHASE_CONFIGS`, skipped legacy archives, used `sha256Hex`, and returned workspace-relative `analysisDir` values with '/' separators. The outer catch logs the error and returns `.ptah/analysis`.
- `libs/backend/agent-generation/src/lib/services/analysis-freshness.service.spec.ts:32-386`: updated relative-path assertions and constructor setup; added archive, v4 fallback, and logger warning cases. Existing no-write assertions remain.

## Task 20.3

- `libs/backend/agent-generation/src/index.ts:30-32`: removed the four requested public barrel exports; retained `AnalysisStorageService`, `AnalysisFreshnessService`, and `ResumableRun`.
- `libs/backend/agent-generation/src/lib/di/register.ts:183`: included `ANALYSIS_FRESHNESS_SERVICE` in the registration log.
- Barrel grep evidence: `rg -n -U --pcre2 'import\s*(?:type\s*)?\{[^}]*\b(?:computeWorkspaceFingerprint|ANALYSIS_MAX_AGE_MS|LegacyRunArchiveError|ManifestReadResult)\b[^}]*\}\s*from\s*\W*@ptah-extension/agent-generation' libs apps -g '*.ts'` returned exit 1 (no matching barrel import).

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-fingerprint.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-freshness.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-freshness.service.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/wizard/analysis-run-checkpoint.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.spec.ts` (line 81 import only, continuation)
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/index.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/di/register.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/.ptah/specs/TASK_2026_652_7284/batch-20-report.md`

## Verification

- `npx prettier --write` on exactly the six source files: passed.
- `npx prettier --check` on exactly the six source files: passed; all matched files use Prettier style.
- `npx prettier --check libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.spec.ts`: passed (exit 0).
- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --parallel=1`: passed both targets after the import edit (exit 0).
- `npx nx run-many -t test -p @ptah-extension/agent-generation --parallel=1 --maxWorkers=2`: passed after the import edit (exit 0). All 37 suites passed. Nx suppressed the successful Jest summary; the inferred test count is 1271 passed and one skipped, from the prior run's 1239 passed/one skipped in 36 suites plus 32 test cases in the repaired suite.
- `npx nx typecheck @ptah-extension/rpc-handlers`: passed (exit 0).
- `npx nx run di-lint:lint`: passed (exit 0).
- Scoped `ptah_get_diagnostics` before the continuation: one error in the then out-of-scope spec; none in the original six edited files. The repaired suite and repeat checks resolved that error.
- Nx Cloud reported the organization disabled (401) after local target results; it did not change the exit codes above.

## Decisions

- The team-leader extended the allowlist by one line in `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.spec.ts:81`; I changed only that import to `../analysis-fingerprint`. No compatibility re-export or git operation was used.

## Fix round

- `libs/backend/agent-generation/src/lib/services/analysis-fingerprint.ts:107`: added an `optional-capability` degradation-audit marker inside `hashFileOrNull`'s catch. Its reason records that unreadable output returns null as a hash mismatch: resume reruns the phase and freshness reports stale; no caller treats null as success. Behaviour is unchanged. `tools/degradation-audit/check-degradation.ts:27-49,102-106` accepts `optional-capability` with a reason after `-` and attaches a marker to the leading comments inside a catch. The baseline file was not changed.
- `npx prettier --check libs/backend/agent-generation/src/lib/services/analysis-fingerprint.ts`: passed, exit 0; all matched files use Prettier code style.
- `npx nx run degradation-audit:lint 2>&1 | grep -E "agent-generation|FAIL|ok \(|error" | tail -15` (PowerShell equivalent `Select-String` / `Select-Object -Last 15`): passed, exit 0. A second audit run filtered to `agent-generation` confirmed `libs/backend/agent-generation: 1 ok (baseline 1)`; the remaining finding is in `user-layer-mirror.service.ts:1934`.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --parallel=1 2>&1 | tail -15` (PowerShell equivalent `Select-Object -Last 15`): passed, exit 0; Nx reported both targets successful. Nx Cloud also reported its disabled organization (401) after the local results.
- Scoped `ptah_get_diagnostics` for `analysis-fingerprint.ts`: 0 errors, 0 warnings.
- Files written in this fix round: `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/agent-generation/src/lib/services/analysis-fingerprint.ts`; `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/.ptah/specs/TASK_2026_652_7284/batch-20-report.md`.
