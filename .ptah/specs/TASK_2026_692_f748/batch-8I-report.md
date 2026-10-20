# Batch 8I report

## Findings and fixes

### N1 — sending deadline left the fire pipeline occupied

Root cause: the reducer closed a timed-out `sending` attempt, but the unresolved sender promise kept the `exhaustMap` inner subscribed. Later fire effects were dropped. The send callback also needed a liveness check at the enqueue boundary.

Fix: `idle-compaction.service.ts:226` applies `takeUntil` to each send using the session's state stream. Leaving `sending` for that attempt unsubscribes the inner and frees `exhaustMap`. The existing `beforeEnqueue` check at `idle-compaction.service.ts:335` requires a live group and the matching current `sending` attempt before taking a claim. It vetoes a callback invoked after the deadline.

Specs: `idle-compaction.service.spec.ts:379` holds the first send forever, advances through its deadline, and verifies a later attempt sends. `idle-compaction.service.spec.ts:480` resumes a send after its deadline and verifies no enqueue, claim, or notice.

### N2 — warning logger could terminate every session

Root cause: warning calls in effect containment, group error handling, and the outer subscriber could themselves throw. The exception could escape the per-group pipeline and terminate the shared stream.

Fix: `idle-compaction.helpers.ts:9` adds `safeWarn`, which catches logger exceptions. All service warning containment paths call it (`idle-compaction.service.ts:101`, `:241`, `:247`, `:293`, `:433`).

Spec: `idle-compaction.service.coalesce.spec.ts:444` makes `warn` throw on every call, fails a signal in one session, then verifies another session fires.

### N3 — rekey collision was silent

Root cause: `resolveIdleSignal` returns `null` for a destination alias owned by another group, with no log.

Fix: `idle-compaction.service.ts:424` detects that collision after resolution and calls `safeWarn` with the reason and two IDs only (`:430`).

Spec: `idle-compaction.service.coalesce.spec.ts:467` verifies the warning contains the source and destination IDs.

### 8G item 1 — normal release logged a false group failure

Root cause: a failed ordinary signal set a flag that remained set through `session-released`, so `finalize` emitted `group-failed` even though the release succeeded.

Fix: `idle-compaction.service.ts:144`, `:155`, `:246` track only a failure of the release signal. The unchanged coalesce scenario's expectation at `idle-compaction.service.coalesce.spec.ts:409` now requires `signal-failed` and excludes `group-failed`.

## Decisions

- Chose `takeUntil` on the existing shared state stream over a separate attempt subject. The stream already emits every phase change, including the deadline transition; this adds no second lifecycle to manage. Reversible.
- Kept warning containment in a small helper taking the injected `Logger`; no logger is constructed or fetched globally. Reversible.

## Verification

- `NX_NO_CLOUD=true npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/idle --coverage=false --maxWorkers=2`: final tail reports **6 suites passed, 81 tests passed**, exit 0. An initial run found a spec assertion expecting `null` where `boundaryNoticeFor` returns `undefined`; the assertion was corrected before the passing run.
- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/agent-sdk --parallel=1`: tail reports `Successfully ran target typecheck for project @ptah-extension/agent-sdk`, exit 0.
- `NX_NO_CLOUD=true npx prettier --check libs/backend/agent-sdk/src/lib/helpers/compaction/idle`: tail reports `All matched files use Prettier code style!`, exit 0.
- Scoped `ptah_get_diagnostics`: 0 errors, 0 warnings. Changed TypeScript files are 500 lines or fewer and have LF line endings.

Final command tails:

```text
Test Suites: 6 passed, 6 total
Tests:       81 passed, 81 total
Snapshots:   0 total
Time:        3.997 s, estimated 5 s
Ran all test suites matching libs/backend/agent-sdk/src/lib/helpers/compaction/idle.
EXIT_CODE=0

NX   Successfully ran target typecheck for project @ptah-extension/agent-sdk
Run duration:      6.9s
Cache:             0/1 hit (0%)
EXIT_CODE=0

Checking formatting...
All matched files use Prettier code style!
EXIT_CODE=0
```

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.helpers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.coalesce.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748\batch-8I-report.md`
