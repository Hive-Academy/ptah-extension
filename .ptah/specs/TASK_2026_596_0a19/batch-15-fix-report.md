# Batch 15 fix (Task 15.1) — TASK_2026_596_0a19

**Verdict**: Fixed. `provider:getAccountUsage` no longer applies the 3 s abort; `provider:getPlanLimits` and the `planLimits:changed` push keep it.

## Change

`libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts`
- `ownerSnapshot` / `readOwner` take a `withDeadline` flag.
- `assemble` (used by `snapshot` → `provider:getPlanLimits`, and by `currentSnapshot` → the push) passes `true`: an `AbortController` plus a `LIMIT_LOOKUP_DEADLINE_MS` (3 s) timer, the same behaviour as before.
- `ownerSnapshotForProvider` (used by `provider:getAccountUsage`) passes `false`: no controller, no timer, and no `signal` in the `getOwnerSnapshot` options. `PlanUsageService.join` then pins the flight (`plan-usage.service.ts:203-205`), so a getPlanLimits caller whose signal aborts at the same moment cannot cancel the read either. The Codex service's own `REQUEST_TIMEOUT_MS` (10 s) bounds the read.
- The failure path is unchanged: a rejected read still returns `unreadSnapshot` from ledger evidence. The `timeout` reason is only logged when a deadline controller exists and fired.
- Updated the file header and the method doc to describe the exception.
- The `ProviderGetAccountUsageResult` contract and the handler (`provider-rpc.handlers.ts`) are unchanged.

## Specs

`libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.spec.ts`
- New: `waits out a Codex cold start longer than the 3 s plan-limits deadline`. Uses fake timers and a Codex owner read that resolves after 5 s, or rejects if a signal aborts it. At 3.5 s the call is still pending. At 5 s it resolves to `available` with `account`, `quota.primary`, `quota.secondary`, `activity` and the plan `windows`, and the read received no signal.
- The existing `reads owners in parallel, each bounded by its own 3 s deadline` (getPlanLimits) still passes unchanged.

`libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.spec.ts`, new `read deadline` block with fake timers and a 5 s read:
- A provider lookup is not cut at 3 s. It resolves `available` at 5 s, and `getOwnerSnapshot` is called with `{ refresh: true }` and no signal.
- A plan-limits snapshot still cuts the read at 3 s. At 2,999 ms it is pending; at 3,000 ms it returns `service-unavailable` and logs reason `timeout`.
- The push (`currentSnapshot`) still cuts the read at 3 s.

## Verification

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers` was run in the foreground with no extra flags. Result: typecheck, test and lint all succeeded (0/3 cache hits, so every target actually ran).

## Scope

Only `libs/backend/rpc-handlers/**` was edited. `libs/backend/vscode-lm-tools/**` and batches.md were not touched, and no git operations were run.
