# Code Logic Review, P8 phase — `TASK_2026_714_c8a2` (PR #823)

Scope read in full: `apps/ptah-electron/src/di/codex-runtime-composition.ts`, `codex-binding-registry.ts`,
`activation/bootstrap.ts` (diff), `activation/shutdown.ts` (diff), `ipc/ipc-bridge.ts` (diff);
`libs/backend/rpc-handlers/src/lib/chat/codex-host/{codex-chat-host-ports,codex-chat-event-callbacks,codex-session-settings-record}.ts`;
agent-sdk `codex-chat-adapter.ts` (open/turn/close), `codex-chat-approval-sink.ts`, `session-approval-router.ts`,
`wiring/codex-thread-identity-store.ts`, `wiring/session-runtime-identity-cache.ts`, `session-metadata-store.ts`
(`updateCodexExecution`); `codex-runtime/src/lib/codex-executable-pin.ts`, `codex-runtime.ts` close path;
`workspace-scope-resolver.ts`; frontend `permission-handler.service.ts` decision table; `branded.types.ts`.
No heavy checks were run. Findings come from reading code and tracing.

## Summary

| Metric              | Value                                   |
| ------------------- | --------------------------------------- |
| Overall score       | 5.5/10                                  |
| Assessment          | NEEDS_REVISION                          |
| Blocking issues     | 1                                       |
| Serious issues      | 6                                       |
| Moderate issues     | 9                                       |
| Failure modes found | 16                                      |

Why 5.5: the approval decision table, duplicate handling, settle-on-decision (D4), host-attention release,
turn identity and lifecycle hooks are correct on the traced paths. The weak spots are around them: Electron
boot and shutdown wiring (one optional feature can put the whole app into the recovery shell, and shutdown
disposes things in an order that defeats its own purpose), one workspace-key mix-up that is wrong on Windows,
and error paths that discard the real `Error`. That sits above band 3-4 (core path wrong) and below band 7-8
(no probable-path defects).

## Known review list: confirmed or rejected

| # | Item (batches.md session 14) | Verdict | Evidence |
| - | ---------------------------- | ------- | -------- |
| 1 | Sync hash + `execFileSync --version` on Electron main at first open | CONFIRMED, worse than listed: it runs on EVERY native open, not once (no cache) | `codex-runtime-composition.ts:264-271` (`readFileSync` whole binary, `execFileSync` timeout 10 s). `createScope` is called by `CodexChatAdapter.open` per session (`codex-chat-adapter.ts:245`). |
| 2 | `tabId(id)` falls back to session id | CONFIRMED | `codex-runtime-composition.ts:225-226`. Feeds prompt `tabId` (`codex-chat-host-ports.ts` present), callbacks `tabId`, broadcaster. A resume with no tab streams to a tab id that does not exist. |
| 3 | Legacy control settings derive auth from the workspace's CURRENT auth | CONFIRMED | `codex-runtime-composition.ts:495-501`, `resolveActiveAuthForPath`. The native record (`codex-session-settings-record.ts:58-59`) is immutable per session, the legacy one is not. |
| 4 | `runtime-admission-mismatch` missing from `rpc-error-codes.types.ts` | CONFIRMED, wider: no `Codex*` or admission code exists in the union, and no rpc-handlers code maps `CodexChatAdapterError` or `ChatRuntimeAdmissionError` to `RpcUserError` | `routing-agent-adapter.ts:13`; grep of rpc-handlers finds only `AuthRequiredError` handling (`chat-session.service.ts:497`). |
| 5 | Compaction trigger `auto` / `preTokens 0` | CONFIRMED | `codex-chat-event-callbacks.ts:107-117`. A manual compaction is labelled auto with a 0-token count. |
| 6 | Hidden-tab terminal slot overwrite | CONFIRMED | `chat-stream-delivery-coordinator.service.ts:233-236` stores ONE `terminal` per hidden tab. Callbacks `error` (`publishTerminal` CHAT_ERROR, `codex-chat-event-callbacks.ts:74-80`) and the broadcaster's CHAT_COMPLETE overwrite each other; whichever is last wins, so a failed turn on a hidden tab can show as complete. |
| 7 | Result reconciliation block index when only deltas streamed | CONFIRMED defect, see S5 | `codex-chat-event-callbacks.ts:98` |
| 8 | Manifest JSON bundled with developer `binaryPath` | CONFIRMED, low risk | manifest `binaryPath` is `D:\projects\ptah-extension\node_modules\...`; `codex-executable-pin.ts:6` requires the whole file. Also only a win32/x64 pin exists (see M7). |
| 9 | agent-sdk max-lines warning | Not a logic matter, route to style review | |
| 10 | D4 settle-on-decision | CONFIRMED correct for the normal path; one failure branch loses the request (S3) | `codex-chat-host-ports.ts:307` |
| 11 | Decision mapping | CONFIRMED correct and consistent with the frontend table | host `codex-chat-host-ports.ts:308-314` equals `permission-handler.service.ts:41-46` (`accept->allow`, `acceptForSession->always_allow`, `decline->deny_with_message`, `cancel->deny`) |
| 12 | turnId from the `turn/start` receipt | CONFIRMED correct | `codex-chat-adapter.ts:512-513`; callbacks message id `JSON.stringify([threadId, turnId])` equals `CodexChatEvents` message id (`codex-chat-events.ts:85`). Session-level cleanup passes `undefined` and content then throws into `safe`, which logs. |
| 13 | UUID v4/v7 acceptance | CONFIRMED correct, with one side effect (M9) | `branded.types.ts:41-43` |
| 14 | sessions.opened/closed hooks | CONFIRMED correct ordering, one gap (M2) | `codex-chat-adapter.ts:259-270, 694-700` |

## Five logic questions

### 1. How does this fail silently?

- Shutdown marks no thread inactive and says nothing useful: `binding.dispose` calls `lookup.dispose()` BEFORE the
  scopes close (`codex-runtime-composition.ts:569-577`). Each scope's `runtime.close()` then calls
  `store.markInactive` (`codex-runtime.ts:799`), which goes through the disposed lookup and throws
  `identity-lookup-disposed` (`session-runtime-identity-cache.ts:104-105`). The runtime swallows it into
  `'Codex identity could not be marked inactive'` (`codex-runtime.ts:800-804`). Every Codex thread stays
  `state: 'active'` after every clean quit (S2).
- A user decision that the router rejects is dropped without a trace: `settle()` runs before `approvals.respond`
  (`codex-chat-host-ports.ts:307`), the boolean result is returned to the IPC bridge, which then falls through to
  the Claude handler for a JSON-array id (`ipc-bridge.ts` new block), and nothing is logged (S3).
- Prompt delivery failure is logged and the approval then waits forever: `broadcastMessage(...).catch(failed)`
  (`codex-chat-host-ports.ts:276-279`) never settles the pending entry or declines the sink; `timeoutAt: 0` (`:272`) means no
  timeout (M3).
- Windows inactive-session settings read the wrong scope and fall back to a global value without an error (S1).
- Every failed native open logs only the constant `'[CodexChatAdapter] runtime-failed: open.'`
  (`codex-chat-adapter.ts:267`); the real `Error` ("No reviewed Codex executable pin for this platform", pin SHA
  mismatch, `execFileSync` ENOENT or timeout) is discarded and the caller gets a generic `runtime-failed` (S4).

### 2. What user action produces unexpected behaviour?

- Quitting the app while a native session is open: unprotected rejection path skips SQLite close, CLI registry, voice
  worker, watcher, diagnostics and the final metadata flush (B/S2).
- Opening the same workspace with a different spelling than at creation (`C:\proj` vs `c:\proj`, trailing slash) and
  resuming: host check compares raw strings and throws `Native resume identity mismatch` (S6).
- Changing model/effort/permission after the session went idle (adapter closed it) on Windows: the config write path
  and baseline use the lower-cased `c:/users/...` key (S1).
- Clicking Deny: maps to `cancel`, which interrupts the whole turn, by design (D-table). Clicking "Decline with message" is not offered for
  native requests (frontend rejects `reason`/`modifiedInput`, `permission-handler.service.ts:450-458`). The IPC owner does not enforce
  that rule; a crafted `permission:response` with `allow` plus `modifiedInput` reaches the sink's replacement branch
  (`codex-chat-approval-sink.ts:168-203`). Harmless today (command-only validation) but the guard lives only in the renderer.
- Reloading the renderer (dev reload, crash) while an approval is pending: the host keeps the entry and the attention
  claim, the renderer has no copy, nothing re-presents it (see Q5).

### 3. What input data produces a wrong answer?

- Windows workspace paths: `normalizeCodexWorkspaceKey` returns lower-cased forward-slash text
  (`codex-home-path.ts:43`). It is stored in `codexExecution.workspaceId` and used as if it were a path in
  `codex-session-settings-record.ts:88-91, 118` (S1).
- Turn that streamed only deltas and finished without `textFinal`: reconciliation publishes the full text at
  `highestBlock + 1 = 0`, which can be the reasoning block's index or a different text block (S5).
- Empty `result.text` with no streamed text: publishes an empty `text_delta` block (M5).
- Resume with `workspaceId` casing differing from the stored thread record: false mismatch (S6).

### 4. What happens when a dependency fails?

- `bindElectronCodexChat` rejects (metadata `getAll` failure, a token missing, `SETTINGS_STORE` unresolved): `bootstrapElectron`
  throws, `main.ts:209-230` shows the storage recovery shell with `startup-failed`. The whole app is down for an
  optional, gated feature (B1).
- `registerCodexRuntime` or either `container.resolve` throws after `createChildContainer()`
  (`codex-runtime-composition.ts:142-156`): the child container is never disposed (M1).
- `execFileSync` times out: blocks the Electron main thread for up to 10 s, then throws a raw error with the binary
  path in its message (S4/S7).
- A hung `runtime.close()` at shutdown: `disposeElectronCodexBindings` has no budget, unlike the gateway stop and agent
  reap (`shutdown.ts:290`). The deferred quit is only re-issued from a `finally`, so a hang means an unclosable app (S2).
- `broadcastMessage` rejecting for a prompt: see Q1 (M3).

### 5. What is missing that the requirements never mentioned?

- A way to re-present pending approvals after a renderer reload (the entries and attention claims survive in
  `pending`, `codex-chat-host-ports.ts:111-120`).
- Per-platform executable pins: `findCodexExecutablePin` returns a pin only for win32/x64 (manifest `platform`/`arch`).
  Any other host throws "No reviewed Codex executable pin" at first open. Fine for the dev route, a hard gate before opening.
- A timeout or window-gone policy for approvals.
- Caching of the verified binary identity (hash plus version) per process.
- Coded errors for the native adapter (`CodexChatAdapterError`, `ChatRuntimeAdmissionError`) in the shared RPC union.

## Blocking issues

### B1. Optional Codex binding failure puts the whole Electron app into recovery mode

- File: `apps/ptah-electron/src/activation/bootstrap.ts:535-542`, `codex-runtime-composition.ts:185-198, 448-450, 591-594`, `main.ts:209-230`
- Scenario: `bindElectronCodexChat` is awaited unguarded on every boot, including packaged builds where the parity gate
  keeps native Codex off. It eagerly runs `initializeSessionRuntimeIdentityLookup` (`metadataStore.getAll()`), and eagerly
  resolves `WORKSPACE_SCOPE_RESOLVER`, `SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER`, `WORKSPACE_PROVIDER`, `PLATFORM_INFO`,
  `WEBVIEW_MANAGER`, `SETTINGS_STORE`, `HOST_ATTENTION_COORDINATOR`. Any one throwing (a corrupt session row, a registration drift
  between hosts) rejects `bootstrapElectron`. `main.ts` treats every rejection as "Workspace storage did not become ready" and loads
  the recovery shell.
- Impact: every Electron user loses the app for a feature that is off for them. The message also blames workspace storage, which
  misdirects diagnosis.
- Fix: bind only when `routing.capabilities.nativeCodex` is true (or catch, log the real `Error`, and register nothing), and make the
  lookup initialisation failure non-fatal for the legacy path. Keep the all-or-nothing binding for the enabled case.

## Serious issues

### S1. Inactive-session settings use the normalized workspace KEY as a path (wrong scope on Windows)

- File: `codex-session-settings-record.ts:78-92, 118`; source of the value `session-metadata-store.ts:978-981`
  (`codexExecution.workspaceId` is `normalizeCodexWorkspaceKey(...)`, `codexThread.workspaceId` keeps the caller path, per the comment at `:113`).
- Scenario (Windows): session created for `C:\Users\abdal\proj`. After the adapter closes it, a config RPC calls `settings(id)`. The identity
  comes from `lookup.lookup(id).persisted` = `codexExecution`, so `workspaceId` is `c:/users/abdal/proj`. `readForPath` hashes
  `path.resolve` of that (`workspace-scope-resolver.ts:16-40`, only the drive letter is lower-cased there), giving a different workspace
  hash than the one the config RPC wrote. Model/effort/autopilot overrides stored for the workspace are not found; the app/global value is
  returned without any error. The returned `workspacePath` is then used by controls for `applyTo` writes, so a change is saved under the wrong key.
- Impact: wrong model, effort or permission level shown and applied after an idle period; settings written to an orphan key.
- Fix: read the raw path from `codexThread.workspaceId` (it is persisted for exactly this reason), or carry the raw `workspacePath`
  in the lifecycle record and never fall back to the normalized value. Add a spec on `process.platform === 'win32'` casing.

### S2. Shutdown: dispose order defeats `markInactive`, and the call can abort the rest of teardown

- File: `codex-runtime-composition.ts:565-588`; `shutdown.ts:290`; `codex-runtime.ts:799-804`
- Scenario A (always): `lookup.dispose()` and `record.dispose()` run first; scopes close afterwards. `markInactive` fails
  (`identity-lookup-disposed`) and is logged as a generic error. All threads stay `active`.
- Scenario B: `disposeElectronCodexBindings` throws an `AggregateError` when any scope close rejects. It sits bare inside
  `disposeAfterPersistence` (`shutdown.ts:290`), while every neighbour is `nonFatal(...)` or budgeted. The throw skips SQLite close, voice
  worker, CLI registry, watcher, diagnostics, `await checksKilled` and the final metadata flush, and is reduced to one console warning by
  `runDeferredDisposal`.
- Scenario C: no budget; a hung close prevents the `finally { deps.quit() }` re-issue.
- Impact: stale `active` state on every restart (the only reader today is `sameBinding`, but it is the planned owner-detection signal),
  and a failure to close one Codex child can leak the voice worker, proxy registry and unflushed session references.
- Fix: dispose scopes first (await), then `record.dispose()`, then `lookup.dispose()`; wrap with `withBudget` or `nonFatal`; run it in
  `disposeBeforePersistence` or at least before the final flush so the `markInactive` write is flushed (the final flush already follows
  `disposeAfterPersistence`, so ordering inside the binding is the only blocker).

### S3. Approval is forgotten when the router rejects the reply

- File: `codex-chat-host-ports.ts:304-330`; `ipc-bridge.ts` permission-response block
- Scenario: user decides; `settle(response.id)` deletes the entry and releases the attention claim; `approvals.respond` returns `false`
  (owner already cancelled, sink context mismatch, schema rejection). Nothing is logged. The renderer already removed the prompt
  (`permission-handler.service.ts` removes it right after `postMessage`). If the sink still holds the request (schema/owner mismatch
  cases), the turn waits with no visible prompt until abort.
- Impact: a hung turn with no UI and no log; D4 correctly removes on decision but must not do so when the decision was not accepted.
- Fix: call `respond` first; settle and release only when it returns `true`. On `false`, log a coded warning (no request content).
  The same applies to a thrown `respond`.

### S4. Real errors are discarded on native open and in the sink

- File: `codex-chat-adapter.ts:267` (open), `:646-650` area (turn), sink `codex-chat-approval-sink.ts:116-127, 135-139, 190-200`;
  `codex-chat-host-ports.ts` `replacement.failed()` logs no Error.
- Scenario: first live open fails in `createScope` (no pin, hash/version mismatch, `execFileSync` timeout, outside-bundle path) or
  `profile()` (identity mismatch). The log shows only `runtime-failed: open`. Nothing records which step failed.
- Impact: the live Electron test cannot be diagnosed from logs; repeats the degradation pattern fixed in `18424ac85`.
- Fix: log the caught `Error` (coded errors carry fixed text, paths excluded) at the catch sites, passing the real `Error` as second argument as `failed()` in host ports already does.

### S5. Result reconciliation corrupts or duplicates content, and races the terminal

- File: `codex-chat-event-callbacks.ts:94-104`
- Scenarios: (a) only deltas streamed, no `textFinal`: `text.size === 0`, `highestBlock = -1`, the full text is published at block 0 as
  `source: 'complete'`. If block 0 is a reasoning block (typical: reasoning first), the accumulator (`accumulator-core.service.ts:277`
  replaces on `complete`) overwrites it with text, or duplicates the answer already streamed at block 1. (b) `safe(...)` is fire-and-forget, so the
  reconcile `text_delta`s can reach the renderer after the broadcaster's `CHAT_COMPLETE`. (c) empty text publishes an empty block.
- Fix: look up the block index that `CodexChatEvents` assigned (expose it from the adapter or reconcile inside `CodexChatEvents`), skip when
  `result.text` is empty or equals what was streamed, and `await` reconciliation before the generator returns (the adapter's `result` wrapper
  is synchronous, so give the callback a promise the adapter awaits before `return`).

### S6. Resume identity check compares raw workspace strings

- File: `codex-chat-host-ports.ts:248-252` (`resume.workspaceId !== profile.workspaceId`)
- Scenario: stored thread record keeps the path as typed at creation (`codexThread.workspaceId`); `prepare` returns the current
  `config.workspaceId ?? identity.workspaceId ?? projectPath`. The resolver already compares normalized keys
  (`workspace-provider-profile-resolver.ts:213-225`), so the host check is the only strict raw check. Drive-letter case or a trailing slash
  difference between sessions yields `Native resume identity mismatch` for the same folder.
- Fix: compare `normalizeCodexWorkspaceKey(a, process.platform)` for both, and keep `profile.workspaceId` as the caller's spelling.

### S7. Binary verification runs on the main thread for every open (known item 1, upgraded)

- File: `codex-runtime-composition.ts:264-271`
- Scenario: each new or resumed native chat reads the whole executable and hashes it synchronously, then blocks on `--version` for up to 10 s.
  The UI freezes on every open; a hung executable freezes it for 10 s. The error text from `execFileSync` includes the executable path.
- Fix: verify once per process (memoise by path+mtime+size), async `crypto.createHash` over a stream, async `execFile` with timeout. `createScope`
  is synchronous by contract, so move the verification into `profile()` (async) or into the binding as a promise the adapter awaits.

## Moderate and minor issues

- M1. Child container leak when `registerCodexRuntime` or `container.resolve` throws after `createChildContainer()` (`codex-runtime-composition.ts:142-156`).
- M2. `sessions.opened` runs after `persistMetadata` (`codex-chat-adapter.ts:259` after `:255`). If `record()` throws (`CodexSessionSettingsError`
  on an out-of-range effort), the open fails with a persisted `codexThread`/`codexExecution` row for a session that never started. Stage before persist or make `record` total.
- M3. Prompt broadcast failure leaves the approval pending forever and `timeoutAt: 0` (`codex-chat-host-ports.ts:272-279`). Decline through the sink when the broadcast rejects.
- M4. Native adapter errors are not coded RPC errors (see list item 4); user sees a generic failure for `busy`, `unavailable`, `identity-mismatch`.
- M5. Empty-text result publishes an empty block (`codex-chat-event-callbacks.ts:98-101`).
- M6. Callbacks never receive `surfaceMode` (`codex-runtime-composition.ts:394-404`): surface-routed chats would publish without the flag the broadcaster path uses.
- M7. Single pin: `codex-executable-pin.ts` supports win32/x64 only; module-load `require` + `.parse` at import time means a manifest regression breaks import of the whole `codex-runtime` lib for every host (VS Code, CLI, TUI) rather than at first use. Make it lazy.
- M8. Legacy settings use `.parse` (`codex-runtime-composition.ts:506, 537`) so a bad stored value throws a raw `ZodError` containing the value; the native record correctly throws a coded error. Use `safeParse` and a fixed message.
- M9. `UUID_REGEX` widening applies to every branded id using it, not only session ids; any tab/message validator now also accepts v7. The reader audit covered "is v4" discrimination, not the wider acceptance. Low risk.
- Minor: `profiles.clear()` runs before scope close (`:573-574`), so a usage `profileForHome` call during close throws "No live Codex session owns this usage home" (logged). `lexical` bundled-root check does not resolve symlinks (`:88-99`).

## Failure modes

### Boot aborts on an optional binding
- Trigger: any throw in `bindElectronCodexChat`. Symptom: recovery shell. Evidence: `bootstrap.ts:535`, `main.ts:209`. Current handling: none. Recommendation: B1.

### Threads never marked inactive
- Trigger: every clean shutdown with a native session. Symptom: log line "could not be marked inactive". Evidence: `codex-runtime-composition.ts:571`, `session-runtime-identity-cache.ts:104`. Recommendation: S2.

### Teardown skipped after a Codex close failure
- Trigger: scope `dispose` rejects. Symptom: later disposal steps and final flush missing. Evidence: `shutdown.ts:290`. Recommendation: S2.

### Orphaned approval
- Trigger: reply rejected by router/sink after local settle. Symptom: turn hangs without a prompt. Evidence: `codex-chat-host-ports.ts:307, 315`. Recommendation: S3.

### Approval never shown
- Trigger: broadcast rejects or window gone. Symptom: turn waits indefinitely. Evidence: `:276-279`, `:272`. Recommendation: M3.

### Wrong settings scope after close (Windows)
- Trigger: `settings()` on a closed session. Symptom: stale/global model, effort, permission; writes to an orphan key. Evidence: `codex-session-settings-record.ts:88-91`. Recommendation: S1.

### False resume mismatch
- Trigger: path spelling change. Evidence: `codex-chat-host-ports.ts:250`. Recommendation: S6.

### Undiagnosable open failure
- Trigger: any open error. Evidence: `codex-chat-adapter.ts:267`. Recommendation: S4.

### UI freeze on open
- Trigger: any native open. Evidence: `codex-runtime-composition.ts:264-271`. Recommendation: S7.

### Corrupted or duplicated assistant text on delta-only turns
- Trigger: no `textFinal`. Evidence: `codex-chat-event-callbacks.ts:98`. Recommendation: S5.

### Terminal overwrite on hidden tab
- Trigger: failed turn on hidden tab: CHAT_ERROR then CHAT_COMPLETE. Evidence: `chat-stream-delivery-coordinator.service.ts:233-236`. Recommendation: key the slot by terminal precedence (error beats complete) or hold both.

### Container leak on registration error
- Evidence: `codex-runtime-composition.ts:142-156`. Recommendation: M1.

### Orphan session row on failed open
- Evidence: `codex-chat-adapter.ts:255-259`. Recommendation: M2.

### Wrong compaction metadata
- Evidence: `codex-chat-event-callbacks.ts:113-116`. Recommendation: carry trigger and token count from the runtime event, or omit the fields the UI renders.

### Import-time failure of the shared lib
- Evidence: `codex-executable-pin.ts:6-19`. Recommendation: M7.

### Renderer reload loses pending approvals
- Evidence: `codex-chat-host-ports.ts:111-120`. Recommendation: re-present from `pending` on snapshot request (`attention:getSnapshot`).

## Data flow (approval)

1. Runtime emits request, sink `request()` dedups by key, registers in router, calls `presentation.present` — OK (`codex-chat-approval-sink.ts:87-144`).
2. Host ports `present`: re-present settles prior entry, stores `{sessionId, request, timestamp}`, broadcasts `permission:request` — OK; delivery failure not handled (M3).
3. Renderer shows the prompt, user decides, `permission:response` goes to IPC — OK (decision validated at `ipc-bridge.ts` new block).
4. IPC resolves `CODEX_CHAT_ADAPTER_PORTS` (guarded by `isRegistered`) and calls `handlePermissionResponse` — OK; falls back to the Claude handler on `false` silently.
5. Host settles (entry removed, attention released with the claimed timestamp) — OK for the normal path; premature on rejection (S3).
6. Decision mapped `allow/always_allow/deny_with_message/deny -> accept/acceptForSession/decline/cancel` — OK.
7. Router checks session/thread/request/context, sink schema validates (`strict`), settles pending, calls `dismiss` — OK; a stale or duplicate reply returns `false` (duplicate-safe).
8. `dismiss` sends `permission:auto-resolved`, frontend no-ops for an already removed prompt — OK.
9. Cancel paths (`cancelPrompt`, abort, dispose) settle host entry, send `permission:prompt-cancelled` with the encoded id, frontend matches by `id` and `sessionId` — OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Approval decision mapping (D table) | COMPLETE | |
| Settle-on-decision pending map (D4) | PARTIAL | settles before acceptance (S3) |
| Host-attention release on every terminal path | COMPLETE | verified for decision, dismiss, cancelPrompt, re-present |
| turnId from receipt | COMPLETE | |
| sessions.opened/closed lifecycle | PARTIAL | M2 ordering; closed also covers failure-after-publish |
| Electron bootstrap before use of ports | PARTIAL | unguarded (B1) |
| Electron shutdown disposal | PARTIAL | S2 |
| Workspace identity (raw vs normalized) | PARTIAL | S1, S6 |
| UUID v4/v7 | COMPLETE | M9 note |
| Executable pin loading | PARTIAL | one platform, import-time, bundled manifest (M7, item 8) |

Implicit requirements not addressed: approval timeout or recovery when the renderer is gone, per-platform pins, coded RPC errors for native failures.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Duplicate user reply | YES | second `pending.get` misses, router/sink return false | falls through to Claude handler (harmless no-op) |
| Cancel racing decision | YES | sink settle is idempotent (`pending.delete`) | host entry removed first, no log |
| Re-presented request, same key | YES | prior notice released, sink also dedups | |
| Numeric vs string requestId | YES | `String()` on both sides | |
| Same requestId across process generations | YES | key includes generation | `cancelPrompt` matches on requestId only, cancels both (acceptable) |
| Session closed then config change | NO | S1 on Windows | |
| Resume with different path casing | NO | S6 | |
| Shutdown with live session | NO | S2 | |
| Open failure | PARTIAL | cleanup is correct (`sink.dispose`, `cleanupOpen`) | error lost (S4) |
| Delta-only turn | NO | S5 | |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on the shutdown, bootstrap, workspace-key and approval-settle findings (traced to source); MEDIUM on S5 (depends on how `CodexChatEvents` assigns block indexes and on accumulator replacement semantics, read but not executed).
- Top risk: an optional, gated Codex binding can take the whole Electron app into recovery mode at boot, and its shutdown path can skip the rest of teardown.
- What a robust implementation would add: guarded, gate-aware binding with real-Error logging; scopes-then-lookup disposal inside a budget and before the final flush; `respond`-then-settle for approvals with a timeout and window-gone decline; raw workspace path carried to every settings read/write and normalized comparison for resume; async, memoised binary verification; a result reconciliation that knows the streamed block index and finishes before the terminal; coded RPC errors for native adapter failures; specs for each (win32 casing, shutdown ordering, rejected reply, hidden-tab terminal).
