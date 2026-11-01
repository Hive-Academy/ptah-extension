# Security review 8q-3a fix

Verdict: APPROVE
Score: 9/10
Review family: grok (implementer: codex)

Static trace of the uncommitted `codex-context.ts` diff, the identity store, and the two new specs. Specs were not executed. No new blocking, serious, or moderate defect.

## M1

Status: CLOSED

`updateNextTurn` now assigns the level-change persist to `this.persistence` before the first await (`codex-context.ts:813-828`). `close` sets `state` to `closed` synchronously (`:924`) and `finishClose` awaits that same promise before `markInactive(this.committedIdentity)` (`:967-973`).

- Close before the persist: `serialize` calls `assertOpen` (`:450-452`, `:459-461`) after `close` has already set `closed`. The update throws `Codex context is not ready` and never calls `persist`. `finishClose` then deactivates the last committed identity.
- Close during the persist: the continuation sees `isClosed()` (`:814`). It does not assign `committedIdentity`, `settings`, or `levelPolicy`. It best-effort `markInactive(nextIdentity)` (`:816`), then rejects with `Codex context closed` (`:822`). The `await` (`:828`) propagates that rejection, so the function does not return `{ timing: 'nextTurn' }`. `finishClose` waits for that rejection (`:967-969`) and only then deactivates `committedIdentity`, which is still the previous identity.
- Close after a successful commit: the continuation's `isClosed()` check and the three assignments are synchronous (`:814-826`), so a close cannot land between the check and the commit. The post-await check (`:829`) then returns success only while the context is still open. A later `close` deactivates the identity just committed.

The store makes the during-persist order safe. `persist` writes `state: 'active'` with the new fingerprint (`codex-thread-identity-store.ts:104-111`). `markInactive` flips that row only when `sameBinding` matches, including `profileFingerprint` (`:46`, `:132-137`). `markInactive(nextIdentity)` therefore matches the row just written. The following `markInactive(old)` fails `sameBinding` and returns the row unchanged, so it stays `inactive`. It does not write `active`.

Rejection handling is single. The closed path throws once inside the `persistence` continuation. `updateNextTurn`'s `await` observes it, `serialize` swallows it for the admission queue (`codex-context.ts:455`), and `finishClose` catches the same promise (`:967-969`). `markInactive`'s own failure is caught inside the continuation (`:817-821`) and does not become a second rejection. There is no second throw on that path: `:829` runs only when the continuation resolved.

The spec `rejects a pending level update on close and deactivates the last committed identity` (`codex-runtime.spec.ts:1597-1630`) holds the mock persist until after `close()`, then expects the update to reject, the committed identity, settings, level policy, and `turnPermissionLevel` to stay on the pre-update values, and `markInactive` to be called first with the pending identity and last with the original. That is the during-persist race. It does not drive the real store, close-before-admission, or close-after-commit. Those two admission cases follow from `assertOpen` and from the synchronous commit above.

## M2

Status: CLOSED

A `turn/started` notification that promotes `idle` to `running` snapshots `settings.permissionLevel ?? profile.permissionLevel` before publishing the turn (`codex-context.ts:401-405`). `turnPermissionLevel` returns that snapshot for the whole `running` or `interrupting` interval (`:207-214`). `updateNextTurn` never writes `activeTurnPermissionLevel`. A notification that arrives while the context is already `running` does not replace the snapshot `start` stored at `:523`.

The snapshot is cleared on every path that ends the turn:

- Completed, failed, and interrupted all become `type: 'terminal'` (`codex-event-translator.ts:251-266`). The handler clears the snapshot whenever `event.turnId === this.activeTurn`, with no status filter (`codex-context.ts:414-426`), and only then sets `idle`.
- `close` disposes the bridge first (`:931`), then clears the snapshot (`:952`). `onNotification` returns immediately once `state` is `closed` (`:360`), so this explicit clear is the one that runs. A disposed bridge short-circuits to `decline` without reading the level (`codex-approval-bridge.ts:335-337`).
- A `CodexRequestRejectedError` before `turn/started` has set `activeTurn` returns to `idle` and clears the snapshot (`codex-context.ts:547-550`). A rejection after `activeTurn` is set keeps the snapshot, which is correct because that turn is live. Any other start failure calls `onFailure` → `close`, which clears it.
- `interrupt` moves to `interrupting` (`:750`) and keeps the snapshot. The getter still returns it (`:208`). `isCurrent` requires `running` (`:275`), so the bridge cancels instead of deciding. A rejected interrupt that restores `running` (`:766-768`) keeps the same snapshot. The later terminal or `close` clears it.

The next turn cannot see the old snapshot. The terminal path clears it before `idle`. The next `start` overwrites it before setting `running` (`:523-524`). The next idle `turn/started` overwrites it at `:402-403`. A compaction item completion does not clear it, and it also does not return `state` to `idle`; that state pairing is unchanged. While a notification arrives in the middle of an uncommitted level persist, the snapshot reads the still-current settings, which is the policy the server is already running.

The spec `holds the level of a notification-started turn until it completes` (`codex-runtime.spec.ts:1633-1661`) starts the turn with `turn/started` while idle after a committed change to `plan`, changes the live level to `ask` mid-turn, and expects `turnPermissionLevel` to stay `plan` and the bridge to `decline`. After `complete()` it expects `ask`, and the next turn's bridge `accept`s. That fails if the snapshot is missing, because the getter would follow the live level, and it fails if the snapshot leaks, because the next approval would still decline. It uses the completed status. Failed and interrupted share the same `type === 'terminal'` clear. It does not call `close` mid-turn.

## New findings

1. Minor — `codex-context.ts:815-822` and `:971-973`. If `markInactive(nextIdentity)` throws after `persist` has already written the new fingerprint as `active`, the catch only logs. `finishClose` then calls `markInactive` with the previous identity. `sameBinding` (`codex-thread-identity-store.ts:46`) compares fingerprints, so the fallback does not match and the row stays `active`. Normal close has one matching `markInactive`; this path's second call cannot repair a failed first call. The context and process are already closed, and a stale active flag is not liveness. The happy path and the spec's mock do deactivate the pending identity.
