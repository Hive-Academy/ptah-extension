# P1-09 — Stage coordinator

## Files

- `libs/backend/review-core/src/lib/review-orchestrator.service.ts` and `review-orchestrator.service.spec.ts`: discovery handler, startup poll, worker drain, stage guards and durability tests.
- `src/lib/stages/discovery-stage.runner.ts`, `context-stage.runner.ts`, `triage-stage.runner.ts`, `lens-stage.runner.ts`, `verification-stage.runner.ts`: stage runners.
- `src/lib/stages/discovery-stage.runner.spec.ts`, `lens-stage.runner.spec.ts`: eligible enqueue and per-lens checkpoint tests.
- `src/lib/lanes/review-lane-selector.ts`, `review-lane.runner.ts` and adjacent specs: FR-7 family fallback.
- `src/di/tokens.ts`, `src/di/registration.ts`, `src/index.ts`: DI and exports.

## Stage diagram

Cron `handler:review:discover` → discover/enqueue → return. Host starts detached `drain(owner, deadline)` → claim → head/trust guard → context → guard → triage/walkthrough → guard → four lenses, each checkpointed → guard → verification → release. Completed checkpoints are reused; a running stage without a checkpoint is marked interrupted and released partial.

## Public API and DI

`ReviewOrchestratorService.discoveryHandler`, `.startupPoll(lastDiscoveryAt)`, `.drain(owner, deadlineMs)`. Host binds `REVIEW_CORE_TOKENS.GITHUB` to `IGitHubReviewPort` and `REVIEW_CORE_TOKENS.ENVIRONMENT` to `ReviewStageEnvironment`. `registerReviewCore` binds stages and coordinator. Cron and detached worker lifecycle are P1-16.

## AC to spec

| Acceptance | Evidence |
| --- | --- |
| AC-1.1–1.5 | Discovery spec verifies eligible enqueue and no claim; coordinator spec verifies 48-hour startup poll. |
| AC-2.1–2.5 | Coordinator spec verifies completed context checkpoint reuse; lens spec verifies only missing lenses rerun. Existing queue repository specs cover claim/dedup. |
| AC-7.1–7.6 | Selector/runner specs verify different-family preference and weaker same-family fallback; verification stage labels each finding. |
| AC-14.1–14.7 | Coordinator specs verify partial for deadline/no-room, stale-head supersession and trust revocation; existing lane specs verify immediate admission results. |

## FR-7 correction

Selector prefers another confirmed-room family, then falls back to the lens family. Runner returns `evidenceStrength: 'weaker'` for same-family verification. Verification stage output associates each candidate finding with `verification: 'cross-family' | 'same-family-weaker' | 'unavailable'`; the entire output is checkpointed. This review-core type keeps the label until P1-16 extends the review-contracts schema under D32. P1-10 must render the label in finding artifacts and preview.

## Decisions

- **Per-lens records:** `lens:<canonical-name>` stages each own a checkpoint. A restart reuses completed results and runs only missing lenses. An interrupted lens is marked interrupted and not rerun because lane invocations lack an idempotency key. Reversible after an idempotent lane API exists.
- **Startup freshness:** host supplies last discovery timestamp; poll when absent or at least 48 hours old. Review repository has no persisted discovery timestamp. Reversible when host supplies durable state.
- **Head/trust guard:** re-read before each content stage; failed guard releases superseded. A distinct trust-revoked status requires a queue contract change. Reversible.

## Open issues for P1-10 and P1-16

- P1-10: consume verification label and checkpoint, render weaker evidence in each finding artifact and preview, and add preview/export fixture coverage. Publication stage was not created in P1-09.
- P1-16: bind GitHub/environment ports, register named cron handler, start worker separately, supply persisted last discovery time, attempt-root permissions and deadlines. GitHub port lacks PR title/body; `ReviewStageEnvironment.pullText?(prNumber)` supplies optional text until P1-16 extends the contract. Extend finding schema for the verification label under D32.
- Remaining P1-09 limitations: lens failure before checkpoint is marked interrupted and does not auto-resume; verification currently checkpoints the aggregate stage, so crash during multiple candidate verifications yields partial on restart. A per-candidate idempotency key would be needed for safe granular retry. No real lanes or GitHub were used in specs.

## Verification

The parent reported `npm run verify -- -p review-core` passed lint, test and typecheck before this fix round. Scoped `ptah_get_diagnostics` after edits reported zero TypeScript errors. D26 forbids this lane from running Nx/npm verify; they were not run here.
