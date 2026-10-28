# Bugfix report: set-up retry on workspace switch (D75 a / D76 item 2)

## Files changed

- MODIFIED `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (+37 lines)
- MODIFIED `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts` (+71 lines)

I did not touch `session-query-executor.service.ts`, its accounts spec or `chat-session.service.ts`. Their diffs in the worktree belong to the parallel developers.

## Fix

`handleWorkspaceChanged()` used to return as soon as `!this.initialized` was true. It now calls a new private `retryInitializeForWorkspace()` before it returns. The initialized path is unchanged, byte for byte.

`retryInitializeForWorkspace()` works like this:

- **Zero folders:** it returns at once and attempts nothing. This follows the TASK_2026_315 rule: with no folder open, `resolveActiveAuth()` falls through to the global default.
- **Serialization:** the retry runs through `queueAdapterPass(...)`, the same chain that resets, config re-inits and provider-scoped session ends use. It therefore runs after any queued pass. Inside the pass, `initialize()` joins a pass that is already in flight through the existing `initInFlight` guard, so two set-ups cannot overlap.
- **Already initialized:** the pass checks `this.initialized` again when it runs. If an earlier queued pass already succeeded, it does nothing.
- **Success:** `doInitialize()` resolves the new workspace's route (for example `claudeCli`), configures auth, sets `initialized = true` and sets health to `available`.
- **Failure:** `initialize()` returns false. `doInitialize` has already set health to `error` with the auth `errorMessage` and emitted `initialized=false`. The adapter stays not initialized, so `notInitializedError()` reports the same `AuthRequiredError` as before, with the new error message. The adapter then logs a fixed-text `logger.warn`.
- **Thrown errors:** a `.catch` on the pass logs a fixed-text `logger.warn` with a real `Error`. This matches the existing `.catch` that logs on the config-change pass. The degradation audit still exits 0 with no new site flagged.

## `startChatSession` lazy `initialize()`: not done

I did not change `startChatSession`, nor the continue and resume paths that throw `notInitializedError()`:

- **Those calls are not lazy initializations.** The existing `await this.initialize()` calls (in `doReset`, `applyWorkspaceAuthChange` and the auth-file-changed handler) each run after an event that changed something: an explicit reset, an auth write, or an auth file change. None of them runs a set-up as a side effect of using the adapter.
- **It would bypass the serialization.** A lazy `initialize()` in the hot path would skip `queueAdapterPass`. It could then race a queued reset or config re-init: `initInFlight` removes duplicate callers but does not order them against resets.
- **It is not cheap.** On a CLI route, `doInitialize` runs `cliDetector.findExecutable()`. On an OAuth route it can refresh a token. Both would eat into the chat admission deadline.
- **It would repeat a known failure on every chat start.** For an API-key route with no key, every chat start would run a set-up that is sure to fail, and log it each time.

The real trigger, a change of workspace route, is now handled where it happens.

## Specs

Added in `sdk-agent-adapter.spec.ts`, under `no-workspace guard on folder change (TASK_2026_315 A1)` > `set-up retry while not initialized (TASK_2026_719 D75)`:

1. `retries the set-up once when a folder is open after the switch`: auth is configured twice, the last call uses `claudeCli`, and health ends as `available`.
2. `does not retry when the switch leaves zero folders open`: auth is configured only once and health stays `error`.
3. `a failed retry leaves the adapter not initialized with its error`: health is `error` with the new `errorMessage`.
4. `an initialized adapter does not re-run the set-up on a same-provider switch`: the initialized path is unchanged. The existing TASK_2026_315 specs also still pass.

## Verification

- `node scripts/verify.mjs -t test,typecheck -p @ptah-extension/agent-sdk -- --output-style=static -- --testPathPatterns=sdk-agent-adapter`
  - test: `Test Suites: 1 passed, 1 total` / `Tests: 144 passed, 144 total`
  - typecheck failed in this form only because the jest flag was forwarded to tsc: `TS5023: Unknown compiler option '--testPathPatterns'`.
- Re-run without the path filter: `node scripts/verify.mjs -t typecheck -p @ptah-extension/agent-sdk -- --output-style=static` gave `Successfully ran target typecheck`, exit code 0.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0 (`TOTAL 278 unsuppressed site(s)`, within baseline).

## Present on origin/main

Yes. `origin/main:libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:476-479` has the same early return:

```
476:  private handleWorkspaceChanged(): void {
477-    if (!this.initialized) {
478-      return;
479-    }
```

## Decisions

- **Retry location:** I put the retry in a separate private method that `handleWorkspaceChanged` calls, instead of reordering the guards in place. That leaves the initialized path and the TASK_2026_315 comment untouched. The change is easy to reverse.
- **No lazy initialization in `startChatSession`:** reasons above. It is easy to reverse.

## Review fix round (code-logic-review-d76 findings 1-2)

**Files**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (`retryInitializeForWorkspace()` only), `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts` (two specs added to "set-up retry while not initialized (TASK_2026_719 D75)").

### Finding 1 (Serious) — retry joined a pass that captured the old route

The queued retry no longer calls straight into `initialize()`, which returned the in-flight pass that resolved workspace A's auth route. Inside the `queueAdapterPass` callback it now:

1. Drains any initialization in flight (`while (this.initInFlight !== null) await this.initInFlight.catch(() => false)`). The loop only awaits passes something else started. It never starts one, and it ends when no pass is in flight. The `.catch` carries the `// degradation-audit: reported - ...` marker because the drained pass's own caller receives its result.
2. Checks the open-folder count again (finding 2, below).
3. If the drained pass left the adapter initialized, it reconciles B's route through the existing `reconfigureAuthIfChanged()`, which is the same path an initialized workspace switch uses. A same-route switch returns early there.
4. Otherwise it runs exactly one fresh `initialize()` pass for the current route. One workspace-change event gets at most one fresh pass, with no retry loop.

### Finding 2 (Moderate) — stale zero-folders guard

The callback calls `getWorkspaceFolders().length === 0` immediately before step 3/4. With zero folders it logs at debug level and does nothing, which keeps the TASK_2026_315 freeze rule. The pre-enqueue check is still there, so a zero-folder event queues nothing.

### Specs added

- (a) `runs a fresh pass for B when a switch lands while A is still initializing and A fails`: A's `configureAuthentication` is deferred. A switch to B (claudeCli) arrives while A's pass is in flight, and no second pass starts while A is pending. Then A resolves `configured: false`. The test asserts a second `configureAuthentication('claudeCli')` and health `available`. Under the old code this would fail because the retry joined A and logged.
- (b) `does not retry when the last folder closes before the queued retry runs`: from a failed adapter, `setFolders(['/ws/b'])` queues the retry, then `setFolders([])` runs before the callback. `configureAuthentication` stays at 1 call and health stays `error`. Under the old code this would fail because the queued callback initialized against the global fallback.
- The 4 existing D75 specs are unchanged and pass.

### Verification

- `node scripts/verify.mjs -t test -p @ptah-extension/agent-sdk -- --output-style=static -- --testPathPatterns=sdk-agent-adapter` → 1 suite, **146 passed**, 146 total, exit 0.
- `node scripts/verify.mjs -t typecheck -p @ptah-extension/agent-sdk -- --output-style=static` → Successfully ran target typecheck, exit 0.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` → TOTAL 278 unsuppressed sites, **exit 0**.

### Decisions

- **Drain instead of join** (options: join the in-flight pass, as before; drain it and then act for the current route; cancel it). Evidence: `doInitialize()` resolves the route synchronously at entry, so a joined pass can never serve B. No cancellation primitive exists. Draining reuses the existing reconcile path. Reversible.
- **Initialized after drain → `reconfigureAuthIfChanged()`, not a re-init.** That is the existing initialized-switch behaviour (see `handleWorkspaceChanged`), so a successful pass for A followed by a switch to B behaves the same as a switch on an initialized adapter. Reversible.

**Out of scope**: finding 3 (`chat-session.service.ts` preparation deadline) is owned by the parallel developer and was not touched.
