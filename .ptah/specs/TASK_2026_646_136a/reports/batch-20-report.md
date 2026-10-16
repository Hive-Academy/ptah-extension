# Batch 20 report

## Verdict

Batch 20 source and colocated specs are written. Decision #78 is implemented: classification starts only after a successful new lane insert, and subagent session identifiers round-trip through all three stores. Scoped TypeScript diagnostics, ESLint, degradation audit, and DI lint pass. Nx and Jest were reserved for the team leader by decision #53 and were not run.

## Files written

- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\lane-outcome-recorder.service.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\lane-outcome-recorder.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\lane-outcome-reader.service.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\lane-outcome-reader.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\skill-telemetry-seam.port.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\agent-signals.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\agent-signals.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\subagent-join.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\subagent-join.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\di\register.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\di\start.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\index.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-20-report.md

## Scope additions (#78)

- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\shared\src\lib\types\lane-outcome.types.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\lane-outcome.schema.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\sqlite-lane-outcome.store.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\sqlite-lane-outcome.store.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\in-memory-lane-outcome.store.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\key-value-lane-outcome.store.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.spec.ts

## Task evidence

- Recorder validates and enqueues lane and subagent outcomes and builds validated deliverables. Budget stop enqueues only a marker (lane-outcome-recorder.service.ts:43-185). Its spec covers budget-before-stop.
- SC-4: pipeline retains the insertIfAbsent boolean and calls the guarded callback only when true (write/outcome-write-pipeline.ts:542-556). Recorder classifies only newly inserted rows with null class, failed/no-deliverable verdict and non-stopped status, fire-and-forget, and updates a non-null result once. Rejections warn with identifiers only (lane-outcome-recorder.service.ts:59-97). Registration wires the callback (di/register.ts:41-68). Pipeline spec covers new/duplicate inserts and throwing callback.
- PB-1: the SDK producer populates subagentSessionId at libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:520-521. Stop payload has no separate run ID at subagent-stop-callback-registry.ts:8-16. The one subagentRunId helper in subagent-join.ts composes the run ID from SUBAGENT_LANE_ID and agentId; the recorder persists payload session identifiers (lane-outcome-recorder.service.ts:99-108). Migration 0054 already has the three columns (libs/backend/persistence-sqlite/src/lib/migrations/0054_lane_outcome_records.ts:63-65).
- P1-L8/TL-16: reader joins telemetry, skills and evidence only at read time and omits null session scopes (lane-outcome-reader.service.ts:97-155). subagent-join.ts derives timeout from budgetStopped or crash from telemetry. No derived class or join is stored. Reader spec covers these cases.
- agentSignals uses the v2 role query and computeAgentSignals (lane-outcome-reader.service.ts:61-90, agent-signals.ts). startLaneOutcomes returns an awaited disposer and does not supply a held-report reader to the pipeline (di/start.ts). Public exports are in src/index.ts.
- Decision #73: no @inject decorator was introduced. Local registrations: logger di/register.ts:27, store :28, pipeline :41, recorder :69, reader :82. Optional classifier and telemetry bindings are checked with isRegistered in di/register.ts:72-94. SDK stop and budget registry registrations are at libs/backend/agent-sdk/src/lib/di/register.ts:263-270. tools/di-lint/check-injects.ts:187-216 requires registered tokens for decorated injections, so explicit factory parameters avoid premature decorated tokens.

## Decisions and risks

- Optional nullable session/workspace fields preserve existing row constructors. SQLite uses the existing 0054 columns; no migration was added. Reversible: yes.
- Classification metadata (status, failureKind, exitCode) is transient and never persisted. On restart, a replayed lane insert may lack this context and skip classification. Persisting it would conflict with decision #78. Duplicate inserts cannot invoke classification. Reversible: yes.
- Reader uses stored subagentSessionId and never agentId as a session ID; null means no skill/evidence join. Reversible: yes.
- Host wiring is owned by Batch 30. No host roots or guard specs were edited.

## Verification tails

- npx prettier --write <changed files>: completed, exit 0.
- npx eslint <changed files>: empty output, exit 0.
- npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1: TOTAL 296 unsuppressed site(s), no FAIL, exit 0.
- npx ts-node --transpile-only tools/di-lint/check-injects.ts: di-lint OK: 1841 @inject sites all resolve to a registered token (807 tokens), exit 0.
- ptah_get_diagnostics after the last source/spec edit: 0 errors, 0 warnings, clean coverage.
