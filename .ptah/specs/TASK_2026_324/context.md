# TASK_2026_324 — Session metadata store: no data loss, no lost writes

Source: regression review of TASK_2026_323 (commit 65a734193 and neighbours).

## Findings to fix

1. **Old-format blobs lose `streamEvents` on any incidental write.**
   `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:145-171` (`leanCliSessionRef`,
   `withLeanCliSessions`) and `:275-298` (`_saveInternal`). Every write path (`save`,
   `addStats`, `rename`, `propagateStatsToParent`, `addCliSession`) strips
   `streamEvents` and truncates `segments` to 200 on EVERY `cliSessions[]` entry, and
   nothing moves the removed data to `ptah.agentOutput:<agentId>`.
   Required: when `_saveInternal` sees a fat ref (inline `streamEvents` or more than
   200 `segments`), migrate it — write the bulk to the per-agent key via
   `saveAgentOutput` (or the same storage call) BEFORE leaning the ref. A ref that has
   no `agentId` must be left untouched. Spec: build a `cliSessions` array with a fat
   ref NOT written through `addCliSession`, call `addStats`, then
   `getCliSessionsForRestore` must return the full events.

2. **`saveAgentOutput` and `addCliSession` are unsequenced and unequally retried.**
   `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:413-441`.
   Required: sequence the two writes (bulk first, then the lean ref) inside the same
   `retryWithBackoff`, so a lean ref is never durable without its bulk. Spec: make the
   bulk write reject once, assert the ref is not written until the bulk succeeds.

3. **No host flushes the coalesced write queue on shutdown.**
   `session-metadata-store.ts:324-331` `flush()` has no external caller.
   Required: expose flush through the adapter or the store token and call it from
   the three shutdown paths: `apps/ptah-electron/src/main.ts` `will-quit` (must be
   synchronous-safe: stage → flush sync if the storage supports it, or start the flush
   before `disposeAll`), `apps/ptah-extension-vscode/src/main.ts` `deactivate()`
   (await it), `apps/ptah-cli/src/main.ts` exit/signal handlers. Spec: stage a write,
   call the host flush path, assert the storage received it.

4. **Per-agent key leak on `cliSessionId` re-association** — `session-metadata-store.ts:542-583`
   (`addCliSession` replaces the slot by `cliSessionId` but never deletes the old
   `agentId`'s output key). Required: delete the old key when the `agentId` changes.

## Constraints

- Do not change the public shape of `getCliSessionsForRestore`.
- `catch (error: unknown)`, log via injected `Logger`.
- Do not touch `agent-process-manager.service.ts` (TASK_2026_326 owns it) or
  `memory-trigger.service.ts` (TASK_2026_330 owns it).

## Verify

```bash
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime
npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime ptah-electron ptah-extension-vscode ptah-cli
```
