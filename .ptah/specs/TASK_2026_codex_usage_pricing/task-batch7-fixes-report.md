# Batch 7 review fixes

## Findings

### B1: A released context rejected all later updates

- Added `openRateLimitsContext` in `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:327`.
  The method clears the released marker and removes pending reads for that context.
- Added the optional `onContextOpened` hook in `libs/backend/codex-runtime/src/lib/codex-runtime.ts:60`.
  `CodexRuntime.open` calls it after a successful open at `codex-runtime.ts:236`.
- Wired the hook to the usage service in `apps/ptah-electron/src/di/codex-runtime-composition.ts:462`.
- Captured the live context before the first await in `codex-account-usage.service.ts:344`.
  This prevents an old pending read from adopting a reopened context.
- Added the spec `accepts an update after release and reopen of the same context` in `codex-account-usage.service.spec.ts:610`.

### S1: The first notification on a cold cache was lost

- Changed `performLiveRead` in `codex-account-usage.service.ts:345`.
  Cached evidence with `fetchedAt >= observedAt` now goes directly to the ledger mapping.
- Kept rejection for refreshed evidence with `fetchedAt < observedAt` at `codex-account-usage.service.ts:375`.
- Added the spec `delivers fresh evidence from the first read on a cold cache` in `codex-account-usage.service.spec.ts:457`.
- Added the spec `rejects a live update when refreshed evidence predates it` in `codex-account-usage.service.spec.ts:475`.

### Moderate: Every notification could force a refresh

- Added a one-second per-home refresh interval in `codex-account-usage.service.ts:43` and `codex-account-usage.service.ts:365`.
  A notification inside the interval reuses the latest cached evidence.
- Added the spec `limits a notification burst to one forced refresh` in `codex-account-usage.service.spec.ts:564`.

### Moderate: The observer buffer survived process respawn

- Clear the buffer before each spawn in `libs/backend/codex-runtime/src/lib/codex-runtime.ts:85`.
- Also check the disposed state immediately before a queued callback at `codex-runtime.ts:141`.

### Moderate: The released-context set grew without a bound

- Bound the set to 256 identifiers in `codex-account-usage.service.ts:44` and `codex-account-usage.service.ts:336`.
  Release refreshes insertion order and prunes the oldest identifier.

### Moderate: The shared client assignment preceded attachment

- Assign `sharedUsage.client` only after `attachCoreClient` returns in `apps/ptah-electron/src/di/codex-runtime-composition.ts:281`.

### Review note: Shared client scope lifetime

- No code change. The review marked this as an unverified ownership question, not a confirmed defect.
- These fixes do not change client ownership or add scope-resolved ports to the client.

## Files changed

- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.spec.ts`
- `libs/backend/codex-runtime/src/lib/codex-runtime.ts`
- `apps/ptah-electron/src/di/codex-runtime-composition.ts`
- `.ptah/specs/TASK_2026_codex_usage_pricing/task-batch7-fixes-report.md`

No batch 8 file changed. No change outside the permitted source list was necessary.

## Verification

- Ptah syntax analysis returned `parseStatus: ok` and zero error nodes for all four edited TypeScript files.
- No test, lint, typecheck, build, Nx, npm, Jest, or Git command ran. The task forbids these commands.
- The coordinator must verify `@ptah-extension/auth-providers`, `@ptah-extension/codex-runtime`, and `ptah-electron`.

## Remaining risk

- The new specs have not run locally.
- The runtime-to-composition reopen path has no new integration spec because the permitted spec list contains only the usage service spec.
- The unconfirmed shared-client scope-lifetime question remains outside this fix set.
