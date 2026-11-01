# Batch 8q-3a fix report

## Fixes

1. **Typed fixture:** `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:1471-1487` types the initial level as `CodexPermissionLevel` and the fixture as `CodexExecutionProfile`, so `runtime.open(initialProfile)` receives the required type without a cast.
2. **Persist and close race:** `libs/backend/codex-runtime/src/lib/codex-context.ts:805-847` tracks the update persist in `this.persistence`, which close awaits. Its continuation checks closure before atomically committing identity, settings, and policy. If close occurs during the persist, it marks the uncommitted identity inactive, rejects with `Codex context closed`, and leaves those fields unchanged. The existing close path then marks the last committed identity inactive. The spec at `codex-runtime.spec.ts:1597` is `rejects a pending level update on close and deactivates the last committed identity`.
3. **Notification turn snapshot:** `libs/backend/codex-runtime/src/lib/codex-context.ts:393-405` snapshots the effective permission level when `turn/started` promotes an idle context to running. The snapshot is cleared on terminal notification and close (`:416-419`, `:940-941`). The spec at `codex-runtime.spec.ts:1633` is `holds the level of a notification-started turn until it completes`; it checks the bridge decision during the turn and the new level on the next turn.

No verification ran, as required. No git write command ran.
