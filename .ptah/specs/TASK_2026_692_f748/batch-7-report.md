# Batch 7 report

## Completion

- **7.1 complete.** Added the plain `IdleCompactionService` and internal barrel. The service routes all signals through one FIFO trampoline and alias index; groups sessions with a release duration; reduces shared state; runs effects; maintains one switched timer; fires through `exhaustMap`; isolates group errors; releases claims and aliases in `finalize`; and disposes subscriptions and state idempotently. `beforeEnqueue` checks liveness, session identity, attempt identity and `sending` phase before claiming. Busy admission, manual reservations, other vetoes and send errors map to the specified feedback reasons. Logs contain only ids, reason codes and token counts. Service length: 337 lines.
- **7.2 complete.** Added a VirtualTimeScheduler suite with a mutable wall clock. It covers arming and claiming, busy admission, manual reservation veto, claim timeout, coordinator BACKOFF at fire and after PreCompact, dwell timeout, failed send, sleep/wake lapse, pending cancellations, release with late feedback, rekey and disposal. The sender implementation that supplies `origin: { kind: 'coordinator' }` and `admission: 'require-idle'` belongs to Batch 9; this suite verifies the service's sender seam and coordinator claim and checks the shared coordinator-origin constant. It cannot assert Batch 9's sendMessage options before that sender exists.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748\batch-7-report.md`

## Verification

- `NX_NO_CLOUD=true npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/idle --coverage=false --maxWorkers=2`: **5 suites, 54 tests passed**. PowerShell lacks `tail`, so output was filtered with `Select-Object -Last 30` instead. Jest emitted an existing ES-module config warning, then completed successfully.
- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/agent-sdk`: **passed**.
- Scoped `ptah_get_diagnostics` after edits: **0 errors, 0 warnings**.

## Validation risks and edge cases

- **A2 coordinator-origin command:** live probe P1 in `batches.md` passed. This batch uses the existing origin constant; Batch 9 implements the sender options.
- **Direct-construction specs:** this new service changes no existing constructor. Its optional collaborators are trailing parameters.
- **Shared settings count:** Batch 5 owns the shared spec. The service reads `getIdleCompactionConfig` and filters all three named change keys.
- **Large service suite:** core cases are here; same-frame ordering, coalescing and 1,000-session retention checks remain assigned to Batch 8. The service stays below 500 lines.
- **Router admission race:** Batch 12 owns the no-await router change. This service claims synchronously inside `beforeEnqueue`, and maps `manual-reserved` to `manual-compact-reserved`; the core spec tests that path.
- **PostCompact state flag:** Batch 1 owns coordinator `postCompactSeen`. This service relies on `claimIdle` and releases claims through reducer effects and group finalization.
- **Pending send after release:** `beforeEnqueue` checks the live group, current session id and current sending attempt. Late feedback is dropped by the alias index. A release-with-unresolved-send spec is included; Batch 8 owns the deferred `beforeEnqueue` ordering case.
- **Timer retention:** production uses Batch 2's unref scheduler by default; virtual-time tests assert timer actions clear on cancellation and release. Batch 8 owns the 1,000-session stress check.
- **Lifecycle manager length:** Batch 9 owns that file; no edit here.
- **UI evidence:** later frontend and visual-review batches own screenshots; no UI edit here.
- **Settings write path:** the service reads provider values at arm and fire and handles relevant configuration notifications synchronously. Persistence wiring belongs to the settings batches.
- **Manual before/after claim and router awaits:** reservation-before-claim is tested here; coalescing and router await interleavings are assigned to Batches 8 and 12.
- **PostCompact/boundary order:** the reducer from Batch 4 supplies both transitions. Batch 8 owns service-level permutations.
- **Same-frame due/input and stale due:** all entry paths use the single FIFO; Batch 8 owns both-order assertions.
- **Late feedback after release:** alias cleanup drops it; a release-and-late-feedback spec is included.
- **Sleep/wake lapse:** a wall-clock jump past cache expiry produces `lapsed` with no send in the core suite.
- **Malformed settings:** Batch 6's provider owns validation. This service consumes its validated result.
- **Rekey and notices:** one alias group and one timer persist across rekey in the core suite; Batch 14 owns boundary notice integration.
- **Codex proxy and OBSERVE_ONLY:** Batch 3 gate and Batch 4 reducer implement the guards; Batch 8 owns the service-level OBSERVE_ONLY cases.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the veto error private to the service | Export a new public error or use a private typed error | Only the sender feedback mapper consumes the error; the plan assigns only a service and internal barrel | Yes |
| Use current reducer state for async feedback session id | Capture the send-time id or read the current id | Rekey changes `state.sessionId` while a send promise may still settle; the reducer accepts feedback for its current id | Yes |
| Use `Select-Object -Last` for filtered verification | `tail -30` or PowerShell equivalent | `tail` is unavailable in this PowerShell workspace; the equivalent kept output bounded | Yes |
