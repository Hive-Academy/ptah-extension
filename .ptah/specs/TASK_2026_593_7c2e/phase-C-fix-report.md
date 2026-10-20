# Phase C fix report

| Finding | Fix file:line | Spec | Tests: line |
| --- | --- | --- | --- |
| S1 deleted banner getters | `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:1446` | Assert failure and warning `NotificationService.upsert` calls with tab scope; retain info banner cases; remove obsolete slot test | `Tests: 85 passed, 85 total` |
| S2 silent voice catch | `libs/frontend/chat/src/lib/services/voice-provider-error.service.ts:100` | Thrown RPC error logs its Error name and keeps notice actionable (`voice-provider-error.service.spec.ts:140`) | `Tests: 10 passed, 10 total` |
| S3 boot and labels | `libs/frontend/core/src/lib/services/back-office-activity.service.ts:163` | Settled failure projects a notice; later ready resolves it; settled remains absent from ticker (`back-office-activity.service.spec.ts:95,108`) | `Tests: 43 passed, 43 total` |
| M5 voice switch race | `libs/frontend/chat/src/lib/services/voice-provider-error.service.ts:95` | Older switch completion retains newer error tracking (`voice-provider-error.service.spec.ts:124`) | `Tests: 10 passed, 10 total` |
| M7 missing attention dependencies | `libs/frontend/chat/src/lib/services/action-banner.service.ts:125` | Injected logger receives a warning when notice services are unavailable (`action-banner.service.spec.ts:70`) | `Tests: 8 passed, 8 total` |

Audit: `degradation-audit: TOTAL 294 unsuppressed site(s)`; no FAIL line.

## Decisions

- Kept `indexing:failed` because `activity:event` emits it and the existing spec drives that path. Removed `indexing:degraded`, `indexing:error`, `database:error`, and `harness:error` labels without a verified emitter.
- Boot notice projection now runs before the settled ticker filter. The public activity ring and its settled filtering remain in place.
- The chat view harness now creates the real banner service in Angular injection context so notification assertions exercise its actual publish path.

## Not done

- Other findings in the review, including the remaining parts of M7, were outside this fix round.
- No build or workspace-wide test run was requested.
