# Code Logic Review — `TASK_2026_538_3ccf` Batch 2

Scope: `apps/ptah-electron/src/ipc/ipc-bridge.ts`, `apps/ptah-electron/src/ipc/webview-manager-adapter.ts`,
`apps/ptah-electron/src/ipc/webview-manager-adapter.spec.ts` (new),
`libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts`,
`libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.spec.ts` (appended `describe`).
Reviewed against `git diff HEAD` for the four modified files and a full read of the new spec file, plus
`implementation-plan.md` Component 9 (lines 483-512), `task-description.md` sections 8 and 11, and `batches.md`
Batch 2 / Batch 8 / Batch 14.

## Summary

| Metric               | Value                                |
| -------------------- | ------------------------------------- |
| Overall score        | 7/10                                  |
| Assessment            | APPROVED                              |
| Blocking issues      | 0                                     |
| Serious issues       | 1                                     |
| Moderate issues      | 0                                     |
| Failure modes found  | 2                                     |

The five files under review implement exactly what `implementation-plan.md:483-512` specifies, byte-for-byte in
several places (the `sendToRenderer` return-value doc comment mirrors the plan text almost verbatim). Their own
unit tests are correct and exercise the stated contract. Tracing the data flow past this batch's file list into
the one production call site that wires `IpcBridge`'s `GetWindowFn`, however, surfaces a real defect that
undermines the batch's central claim — truthful "is the renderer really there" reporting — for a state the
production app can actually reach. That defect lives outside this batch's file list and cannot be fixed inside it,
so it does not block approval of the five files reviewed here, but it must be tracked before Req 11.1/11.4 can be
called proven end to end.

## Five logic questions

### 1. How does this fail silently?

- It does not fail silently in the sense of reporting `delivered` for a drop: every path returns `false` or throws
  synchronously in a way `sendMessage`'s `try/catch` catches (`webview-manager-adapter.ts:52-59`). No caller of
  `sendMessage` can observe `true` for a message that was not handed to `webContents.send` or queued.
- It does fail silently in a weaker sense: `getActiveWebviews()` can report a surface that is not actually
  reachable (see Serious issue below). The caller is not lied to about delivery — it still gets `false` from the
  attempted send — but it is told a surface existed and rejected the push (`failed`), when the true, cheaper
  answer was that there was never a live surface to begin with (`no-surface`). See Failure mode 1.

### 2. What user action produces unexpected behaviour?

Closing the Electron main window when the app has no keep-alive tray (`trayKeepalive` ships `false`,
`main.ts:265-270`) on a platform where `window-all-closed` does not quit the app (`process.platform === 'darwin'`,
delegated to `handleWindowAllClosed` at `main.ts:329-335`). The app process stays alive with a destroyed
`BrowserWindow` still referenced by `mainWindow` (nothing ever resets it to `null` — see Serious issue). Any
surface push attempted in that state is misreported by `getActiveWebviews()` as having one live surface, and the
resulting `createDashboardBroadcast` outcome (once wired in Batch 8/14) will read `failed` rather than the correct
`no-surface`.

### 3. What input data produces a wrong answer?

Not applicable in the classic sense — these files parse no external payload. The closest analogue is the
`GetWindowFn` return value: the code correctly treats a `null` return and a `webContents.isDestroyed() === true`
return as "not live," but the third state the plan's docstring is written to defend against —
`webContents.isDestroyed()` genuinely `true` on a real, destroyed `webContents` — never reaches the check in
production because the one production `GetWindowFn` never forwards that method (see Serious issue).

### 4. What happens when a dependency fails?

- `sendToRenderer` throwing: caught by `ElectronWebviewManagerAdapter.sendMessage`'s `try/catch`
  (`webview-manager-adapter.ts:52-59`) → `false`, no rejection. Verified by the "returns false instead of
  rejecting when the bridge throws" spec (`webview-manager-adapter.spec.ts:94-105`).
- `hasLiveRenderer()` throwing (e.g. a `getWindow()` implementation that itself throws): **not** caught anywhere
  in this batch. `getActiveWebviews()` has no `try/catch` (`webview-manager-adapter.ts:72-74`). Today's production
  `getWindow` closures (`bootstrap.ts:175-184`, `:318-327`) are simple property reads that cannot throw, so this
  is latent rather than live, but it is worth noting for Batch 8, which is explicitly tasked with hardening
  `createDashboardBroadcast` against "a throwing enumeration" (`batches.md` Task 8.1) — that hardening lives in the
  broadcast wrapper, not in the adapter, so the adapter itself stays exception-prone by contract. Consistent with
  the plan's division of responsibility; not a defect in this batch.
- CLI adapter: `getActiveWebviews()` is a constant `[]`, verified never to throw
  (`cli-webview-manager-adapter.spec.ts:120-124`). No dependency to fail.

### 5. What is missing that the requirements never mentioned?

An end-to-end test that constructs `IpcBridge` the way `bootstrap.ts` actually constructs it (a `GetWindowFn`
closure that wraps a real or realistic `BrowserWindow`-shaped object) and destroys the window before a push, to
prove `hasLiveRenderer()` and `sendToRenderer` behave correctly against the *actual* object graph rather than a
hand-built fake. Neither this batch's spec, nor Batch 14's planned `Task 14.1` (which drives
`createDashboardBroadcast(() => adapter, logger)` against the same kind of hand-built `IpcBridgeFake`), nor
`Task 14.4`'s "Electron composition spec" (scoped to DI resolution ordering, per its validation note) closes this
gap. See Serious issue.

## Failure modes

### 1. `hasLiveRenderer()` cannot detect a destroyed-but-still-referenced window in production

- Trigger: the Electron main window is closed while the app process stays alive (macOS, no tray — the shipped
  default per `main.ts:265-270` and `handleWindowAllClosed`). `mainWindow` in `main.ts` is only ever reassigned by
  `setMainWindow` when a *new* window is created (`bootstrap.ts:248-251`); nothing resets it to `null` on close or
  on the `'closed'` event, so `getMainWindow()` keeps returning the destroyed `BrowserWindow`.
- Symptom: `IpcBridge.hasLiveRenderer()` (`ipc-bridge.ts:188-191`) and the pre-existing `isDestroyed?.()` checks in
  `sendToRenderer`/`flushStreamQueue` (`ipc-bridge.ts:171`, `:283`) all read `win.webContents.isDestroyed?.()` on
  the object `getWindow()` returns. The **sole** production construction of `IpcBridge`
  (`bootstrap.ts:318-327`) supplies:
  ```ts
  const ipcBridge = new IpcBridge(container, () => {
    const win = getMainWindow();
    if (!win) return null;
    return {
      webContents: {
        send: (channel: string, ...args: unknown[]) => win.webContents.send(channel, ...args),
      },
    };
  });
  ```
  This object has no `isDestroyed` property at all. `win.webContents.isDestroyed?.()` therefore evaluates to
  `undefined` via optional chaining — never `true` — regardless of whether the real, wrapped `win.webContents` is
  actually destroyed. `hasLiveRenderer()` returns `true` whenever `getMainWindow()` is non-null, full stop.
  `getActiveWebviews()` (`webview-manager-adapter.ts:72-74`) therefore reports `['ptah.main']` even when the
  window is destroyed.
- Evidence: `apps/ptah-electron/src/activation/bootstrap.ts:318-327` (the only `new IpcBridge(` in production
  code, confirmed via `grep -rn "new IpcBridge(" apps/ptah-electron/src --include=*.ts | grep -v spec`);
  `apps/ptah-electron/src/ipc/ipc-bridge.ts:91-97` (`ElectronWindowHandle.webContents.isDestroyed` is `?`, so
  TypeScript accepts the incomplete object with no compile error — this is exactly why it was not caught by
  typecheck); `apps/ptah-electron/src/main.ts:237,251` (`getMainWindow: () => mainWindow`, never reset to `null`
  on close) and `apps/ptah-electron/src/windows/main-window.ts:167-183` (`'close'` handler has no
  `preventDefault`, so the window really is destroyed, just not dereferenced); `apps/ptah-electron/src/main.ts:329-335`
  and the `handleWindowAllClosed` comment at `:324-328` (macOS + no tray does not quit).
- Current handling: none. `getActiveWebviews()` has no fallback beyond `hasLiveRenderer()`, and nothing downstream
  of it (in this batch) re-verifies liveness before attempting the send.
- Downstream consequence once Batch 8/14 land: `createDashboardBroadcast` (`dashboard-namespace.builder.ts`,
  read in full for this review) calls `host.getActiveWebviews()` once, sees one "surface," calls
  `host.sendMessage('ptah.main', ...)`, which calls `sendToRenderer`, which calls
  `win.webContents.send('to-renderer', message)` on the real, destroyed `webContents` — this throws (the
  codebase's own comment at `ipc-bridge.ts:341-343` documents that Electron throws `"Object has been destroyed"`
  for exactly this call on a destroyed sender). The throw is caught by `sendMessage`'s `try/catch`, so the caller
  never sees an unhandled rejection or a `delivered` lie — but `createDashboardBroadcast` then computes
  `delivered = 0, surfaces = 1` and returns `{ status: 'failed', reason: '1 of 1 attached surface(s) did not
  accept the spec' }`. Per the requirement text at `task-description.md:397-410` and the adapter's own doc comment
  (`webview-manager-adapter.ts:62-71`: "Returning `[]` ... is what lets `createDashboardBroadcast` report
  `no-surface` (a success) instead of a failed send against a window that is not there"), the intended, honest
  answer for this state is `no-surface`. The tool result the agent receives (Req 8.6) will therefore carry a
  spurious delivery-failure detail for a state that is, by the task's own design, not a failure.
- Recommendation: not fixable inside Batch 2's file list (the scope guard excludes `bootstrap.ts`, and the batch
  was not assigned this file). Flag for the team-leader/architect: either (a) have `bootstrap.ts`'s `getWindow`
  closure forward `isDestroyed` (`webContents: { send: ..., isDestroyed: () => win.webContents.isDestroyed() }`),
  or (b) reset `mainWindow` to `null` on the window's `'closed'` event in `main.ts`, or (c) add a Task 14.4-style
  composition spec that drives the *real* `bootstrap.ts` wiring (not a hand-built `IpcBridgeFake`) through a
  destroyed window, so this is caught before Req 11.1/11.4 are signed off. This is a residual risk on the task as
  a whole, not a reason to revise Batch 2's own files.

### 2. Queued (batched) stream events report `true` before delivery is attempted

- Trigger: `sendToRenderer` is called with a message whose `type` is in `BATCHABLE_STREAM_TYPES`
  (`ipc-bridge.ts:57-66`). It is pushed onto `streamQueue` and `true` is returned immediately
  (`ipc-bridge.ts:161-165`); the actual `webContents.send` happens up to `STREAM_FLUSH_INTERVAL_MS` (16 ms) later,
  inside `flushStreamQueue` (`ipc-bridge.ts:270-297`), which can itself find no window or a destroyed one and drop
  the batch silently (`:280-285`) with no way to reach back to the original `true` return.
- Symptom: a caller reading the `sendToRenderer`/`sendMessage` boolean as "delivered" is told `true` for an event
  that can still be lost 16 ms later.
- Evidence: `apps/ptah-electron/src/ipc/ipc-bridge.ts:160-176` (the `return true` for the queued branch),
  `:270-297` (the flush that can drop with no signal back).
- Current handling: this is the behaviour `implementation-plan.md:494-498` explicitly specifies ("`sendToRenderer`
  returns `true` when handed to `webContents.send` **or enqueued as a batched stream event**") and
  `task-description.md:508` (risk row 7: "No criterion for partial or failed delivery after commit — Accepted,
  following the v1 precedent — Req 8.6"). It is a deliberate, plan-level acceptance, not an omission in this
  batch.
- Scope check for this batch: `BATCHABLE_STREAM_TYPES` (`ipc-bridge.ts:57-66`) lists `CHAT_MESSAGE_CHUNK`,
  `CHAT_CHUNK`, `CHAT_THINKING`, `CHAT_TOOL_PROGRESS`, `AGENT_SUMMARY_CHUNK`, `SETUP_WIZARD_ANALYSIS_STREAM`,
  `SETUP_WIZARD_SCAN_PROGRESS`, `INDEXING_PROGRESS`. `MESSAGE_TYPES.SURFACE_UPDATED` does not exist yet (it is
  Batch 7, Task 7.1) and is not in this set. No surface push can take the "queued, maybe-lost" path today, so this
  batch's own `sendMessage`/`getActiveWebviews` truthfulness claim for surface delivery is not compromised by it.
- Recommendation: no action for Batch 2. When Batch 7/8 add `SURFACE_UPDATED` and wire `surface-push.ts` through
  `createDashboardBroadcast`, confirm `SURFACE_UPDATED` is **not** added to `BATCHABLE_STREAM_TYPES` (or, if it
  ever is, that the accepted-risk language in `task-description.md:508` is revisited for the surface case
  specifically, since surface delivery outcomes are reported to the agent as data, not just a UI-perf detail).

## Blocking issues

None found in the five files under review.

## Serious issues

### `hasLiveRenderer` / `isDestroyed` detection is unreachable in the deployed app

- File: `apps/ptah-electron/src/activation/bootstrap.ts:318-327` (production wiring, outside this batch's file
  list) exercised through `apps/ptah-electron/src/ipc/ipc-bridge.ts:188-191` (`hasLiveRenderer`, added by this
  batch).
- Scenario: main window closed on macOS with no tray (the shipped default). See Failure mode 1 for the full
  trace.
- Impact: a caller relying on the surface-delivery outcome (`ptah_surface_update` / `ptah_dashboard_propose_spec`
  per Req 8.6) gets `failed` instead of the intended `no-surface` for a state the app can genuinely be in. Not
  data loss, not an unhandled rejection, not a `delivered` lie — but a wrong, more alarming classification of an
  expected state, which the plan and this batch's own doc comments treat as the exact distinction the adapter
  exists to get right.
- Fix: see Failure mode 1's recommendation. Out of this batch's file scope; escalate to the team-leader/architect
  for a follow-up task (most naturally a `bootstrap.ts` wiring fix plus a composition-level spec that exercises
  the real `GetWindowFn`, since neither this batch's spec nor the planned Task 14.1/14.4 specs construct
  `IpcBridge` the way production does).

## Moderate and minor issues

- Minor — unused `catch (error: unknown)` binding: `apps/ptah-electron/src/ipc/webview-manager-adapter.ts:54`.
  Confirmed live with `npx nx run ptah-electron:lint --files=apps/ptah-electron/src/ipc/webview-manager-adapter.ts`:
  `54:14 warning 'error' is defined but never used @typescript-eslint/no-unused-vars`. This contradicts the
  team-leader's verification note that none of the project's 14 lint warnings sit in a Batch 2 file — one does.
  Not a logic defect (the `catch` body's behaviour, "any throw here means the destroyed-window race; report
  `false`," is correct and matches the doc comment above it), but it should be fixed for cleanliness: either
  `catch { return false; }` (drop the binding entirely, matching the pattern used for genuinely-unused catch
  variables elsewhere in this codebase) or reference `error` in a debug log. Routed here rather than to
  code-style-review because the team-leader specifically asked this reviewer to decide fix-or-accept; the
  underlying logic is unaffected either way.

## Data flow

1. Backend service calls `ElectronWebviewManagerAdapter.sendMessage(viewType, type, payload)` — OK, ignores
   `viewType` as documented (Electron has one renderer).
2. `sendMessage` calls `IpcBridge.sendToRenderer({ type, payload })` inside `try/catch` — OK, a throw cannot
   escape as a rejection (`webview-manager-adapter.ts:52-59`, proven by
   `webview-manager-adapter.spec.ts:94-105`).
3. `sendToRenderer` classifies the message: batchable-stream vs direct — OK for direct; for batchable, delivery is
   deferred past the return (`ipc-bridge.ts:160-176`) — accepted plan-level risk, not exercised by any current
   surface-push type (see Failure mode 2).
4. `sendToRenderer` resolves the window via `resolveWindow`/`getWindow()` and checks `isDestroyed?.()` — the check
   is correct in isolation but **the value it reads is never populated by the only production `getWindow`
   implementation** (see Failure mode 1). This is the one real gap in the traced path.
5. `getActiveWebviews()` asks `hasLiveRenderer()` the same question, with the same gap, and returns `['ptah.main']`
   or `[]` accordingly — OK against its own unit contract, not-OK against the real object graph in the destroyed-
   but-referenced-window state.
6. `CliWebviewManagerAdapter.getActiveWebviews()` — a pure constant, no data flow to trace, verified never to
   throw.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Component 9 / `sendToRenderer` returns a truthful boolean (`implementation-plan.md:494-498`) | COMPLETE | None against the stated contract; see Failure mode 1 for the production-wiring caveat that sits outside this component's own text. |
| Component 9 / `hasLiveRenderer()` (`implementation-plan.md:495`) | PARTIAL | Function is implemented exactly as specified, but the only production caller of `GetWindowFn` never supplies a working `isDestroyed`, so the destroyed-window branch is dead in the shipped app. |
| Component 9 / `ElectronWebviewManagerAdapter.getActiveWebviews()` / `sendMessage` (`implementation-plan.md:487-488, 503-506`) | COMPLETE | Correct against its documented contract and its own spec; see the same production-wiring caveat. |
| Component 9 / `CliWebviewManagerAdapter.getActiveWebviews()` (`implementation-plan.md:492-493`) | COMPLETE | None. |
| Req 11.1 (Electron `delivered` with window present) | COMPLETE at unit level | Not proven end to end through `createDashboardBroadcast`/the real DI wiring yet — by design, deferred to Task 14.1, per R7. |
| Req 11.2 (CLI `no-surface`, no throw) | COMPLETE | `cli-webview-manager-adapter.spec.ts` proves both directly. |
| Req 11.4 (structural `DashboardSurfaceHost` compatibility) | COMPLETE at signature level | Both adapters' `getActiveWebviews(): readonly string[]` / `sendMessage(...): Promise<boolean>` match `DashboardSurfaceHost` (`dashboard-namespace.builder.ts`); the type-level `const _h: DashboardSurfaceHost = adapter` assertion itself is Task 14.1, not this batch. |
| Req 8.6 (delivery outcome reported separately from commit; no false `delivered`) | PARTIAL for the specific `no-surface` vs `failed` distinction | `delivered` is never reported for a failed send (verified). The distinct claim that a destroyed-but-not-yet-collected window reports `no-surface` rather than `failed` cannot be verified end to end today — see Serious issue. |

Implicit requirements not addressed: a composition-level test that constructs `IpcBridge` the way `bootstrap.ts`
does and destroys the underlying window mid-flow (see "What is missing that the requirements never mentioned").

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| No window | YES | `getActiveWebviews()` → `[]`; `sendMessage` → not reached (`no-surface` upstream once wired) | None |
| Window destroyed before enumeration (fake `isDestroyed()` returns `true`) | YES | Proven by `webview-manager-adapter.spec.ts:39-46` and the `IpcBridge` unit's own `isDestroyed?.() === true` branch | None at unit level |
| Window destroyed between enumeration and send | YES (as two separate assertions) | `webview-manager-adapter.spec.ts:48-63` (two independent `getActiveWebviews()` calls) plus `:83-92` (`sendMessage` returning `false` while `hasLiveRenderer` is mocked `true`) — together they cover the actual race shape, since `createDashboardBroadcast` calls `getActiveWebviews()` once and `sendMessage()` once, never two enumerations in a row | The test named "destroyed between enumeration and send" does not itself chain one enumeration into one send; it asserts two enumerations. The *combination* of it with the separate `sendMessage`-returns-`false` test does cover the real sequence. Sufficient for this batch, given the full sequence through `createDashboardBroadcast` is explicitly Task 14.1's job. |
| Send throws | YES | `webview-manager-adapter.spec.ts:94-105`, resolves `false`, no rejection | None |
| CLI never throws / always `[]` | YES | `cli-webview-manager-adapter.spec.ts:110-124` | None |
| Real destroyed `BrowserWindow` still referenced (macOS, no tray) | NO | N/A | See Serious issue / Failure mode 1. Not exercisable from this batch's files alone. |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: `IpcBridge.hasLiveRenderer()`'s destroyed-window detection is dead code in the shipped app because the
  only production `GetWindowFn` (`bootstrap.ts:318-327`) never forwards `webContents.isDestroyed`, so a destroyed-
  but-still-referenced main window (reachable on macOS without the tray keep-alive, the default) is reported as a
  live surface. This does not cause a `delivered` lie or an unhandled rejection, but it does turn an intended
  `no-surface` outcome into a `failed` one once Batch 8/14 wire delivery through `createDashboardBroadcast`. Not
  fixable inside Batch 2's file list; needs a follow-up task against `bootstrap.ts` (or `main.ts`'s window-close
  handling) plus a composition spec that drives the real wiring, not a hand-built fake.
- What a robust implementation would add: (1) a composition-level spec, alongside or in place of Task 14.4, that
  builds `IpcBridge` through code resembling `bootstrap.ts`'s actual closure and destroys the wrapped window,
  proving `hasLiveRenderer()` flips to `false`; (2) `bootstrap.ts`'s `getWindow` forwarding
  `webContents.isDestroyed` (or `main.ts` nulling `mainWindow` on `'closed'`) so the check this batch added has a
  real signal to read; (3) the unused `catch (error: unknown)` binding cleaned up for lint hygiene.

## Task 2.4 re-review

Delta reviewed: `git diff HEAD` for `apps/ptah-electron/src/activation/bootstrap.ts` and
`apps/ptah-electron/src/ipc/webview-manager-adapter.ts`, plus a full read of the new
`apps/ptah-electron/src/ipc/ipc-bridge.live-renderer.spec.ts`. `ipc-bridge.ts` itself is untouched by this delta.
Independently re-run rather than taken on the lane's word: `npx jest -c apps/ptah-electron/jest.config.ts
apps/ptah-electron/src/ipc` → 5 suites, 29 tests, all pass; `npx nx run ptah-electron:lint --files=<the three
delta files>` → 13 problems workspace-wide, 0 of them in any of the three delta files (the prior
`webview-manager-adapter.ts:54` unused-catch-binding warning is gone).

### Fix in detail

`createMainWindowHandleGetter` (`apps/ptah-electron/src/activation/bootstrap.ts:130-148`, new, exported) replaces
the inline closure that used to be built ad hoc inside `bootstrapElectron` (`bootstrap.ts:339` now calls it
directly: `createMainWindowHandleGetter(getMainWindow)`). The returned `GetWindowFn`:

```ts
return () => {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return null;
  return {
    webContents: {
      send: (channel, ...args) => win.webContents.send(channel, ...args),
      isDestroyed: () => win.isDestroyed() || win.webContents.isDestroyed(),
    },
  };
};
```

- **Closes Failure mode 1 / the Serious issue end to end.** The old closure (`bootstrap.ts:318-327` pre-fix, quoted
  in the original finding above) never populated `webContents.isDestroyed` at all, so `IpcBridge.hasLiveRenderer()`
  could never observe a destroy. The new one checks the *native* `win.isDestroyed()` before returning a handle at
  all (`bootstrap.ts:145`), and additionally forwards a working `webContents.isDestroyed` on the handle it does
  return (`:147`). A main window closed on macOS with no tray — `mainWindow` still referenced, never nulled,
  exactly the scenario traced in the original finding — now makes `win.isDestroyed()` return `true`, so the getter
  returns `null`, so `IpcBridge.hasLiveRenderer()` returns `false`, so `ElectronWebviewManagerAdapter
  .getActiveWebviews()` returns `[]`. Verified directly, not just asserted: `ipc-bridge.live-renderer.spec.ts:59-79`
  ("drops a still-referenced window once the native window is destroyed") constructs the getter through the real
  exported `createMainWindowHandleGetter`, flips `win.isDestroyed` to `true` on the *same* object the getter was
  built from (simulating the dangling `mainWindow` reference), and asserts `hasLiveRenderer()` → `false`,
  `getActiveWebviews()` → `[]`, `sendToRenderer(...)` → `false`, and `win.webContents.send` never called.
- **Re-reads on every call, not a captured stale reference.** The exported function takes `getMainWindow` and
  returns a *new* arrow function that calls `getMainWindow()` afresh on every invocation
  (`bootstrap.ts:139-141`). Since `IpcBridge.hasLiveRenderer()`/`resolveWindow()` call `this.getWindow()` every
  time they run (not cached), each call re-fetches the live `mainWindow` variable through the caller-supplied
  `getMainWindow`. `ipc-bridge.live-renderer.spec.ts:114-124` goes further and proves even a *single already-built*
  handle stays live-aware, because its `isDestroyed` closure reads `win.isDestroyed()` at call time, not at
  handle-construction time.
- **No behaviour change for the existing live-window path.** For a live window, `win.isDestroyed()` is `false`, so
  the new pre-check is a no-op and the handle is built and used exactly as before. Proven by
  `ipc-bridge.live-renderer.spec.ts:44-57` ("reports a live renderer and forwards the message unchanged"):
  `hasLiveRenderer()` → `true`, `getActiveWebviews()` → `['ptah.main']`, `sendToRenderer(message)` → `true`, and
  `win.webContents.send` receives the message unchanged. The pre-existing `apps/ptah-electron/src/ipc/ipc-bridge.batching.spec.ts`,
  `ipc-bridge.window-availability.spec.ts` and `ipc-bridge.cpu-profile.spec.ts` build `IpcBridge` with their own
  hand-rolled `getWindow` (not through `createMainWindowHandleGetter`), so they are structurally unaffected by this
  change and are included in the 5/5 passing suites confirmed above.
- **Defensive ordering avoids a second failure mode the fix could have introduced.** `win.isDestroyed()` is
  checked *before* the handle (and its `webContents.isDestroyed` closure) is even constructed
  (`bootstrap.ts:145`), so a destroyed native window never causes `win.webContents.isDestroyed()` to be touched.
  `ipc-bridge.live-renderer.spec.ts:59-79` pins this precisely: `win.webContents.isDestroyed` is mocked to *throw*
  once the native window is destroyed, and the test still passes, proving that path is never reached.
- **`webview-manager-adapter.ts:52-59`**: `catch { return false; }` replaces `catch (error: unknown) { return
  false; }`. Behaviourally identical (confirmed by the still-passing
  `apps/ptah-electron/src/ipc/webview-manager-adapter.spec.ts:94-105`, unchanged by this delta); it only removes
  the unused binding this review's Minor finding flagged. Confirmed no longer flagged by lint (see command output
  above).
- **The spec imports the production symbol.** `ipc-bridge.live-renderer.spec.ts:4` —
  `import { createMainWindowHandleGetter } from '../activation/bootstrap';` — not a re-implementation. Both
  `webview-manager-adapter.spec.ts` (Batch 2's original spec) and this new spec continue to exist side by side:
  the original still tests the adapter against a hand-built `IpcBridgeFake`, and this one tests the same adapter
  against a real `IpcBridge` wired through the real production getter, closing exactly the gap the original review
  identified ("neither this batch's spec... constructs `IpcBridge` the way `bootstrap.ts` actually constructs it").

### Residual note

`main.ts`'s `mainWindow` variable is still never reset to `null` on close — but that no longer matters for
correctness, since `win.isDestroyed()` on the dangling reference now correctly reports `true` and the getter
short-circuits to `null` before anything touches `webContents`. The original finding's alternative fix (b),
resetting `mainWindow` on `'closed'`, was not taken; fix (a) (forward `isDestroyed`) was, and it fully closes the
gap on its own. No further action needed for this finding.

### Verdict

- Recommendation: **APPROVED**
- Evidence: `apps/ptah-electron/src/activation/bootstrap.ts:130-148` (new `createMainWindowHandleGetter`, native
  + webContents destroy checks, re-reads `getMainWindow()` per call), `:339-342` (sole production call site now
  uses it), `apps/ptah-electron/src/ipc/webview-manager-adapter.ts:54` (`catch {` — no unused binding),
  `apps/ptah-electron/src/ipc/ipc-bridge.live-renderer.spec.ts:44-124` (5 cases against the real, exported getter
  and a real `IpcBridge`, including the exact destroyed-but-referenced-window scenario from the original Serious
  finding). Independently reproduced: jest 5/5 suites, 29/29 tests green;
  `npx nx run ptah-electron:lint --files=apps/ptah-electron/src/activation/bootstrap.ts,apps/ptah-electron/src/ipc/webview-manager-adapter.ts,apps/ptah-electron/src/ipc/ipc-bridge.live-renderer.spec.ts`
  shows 0 warnings among the 13 workspace-wide.
- The Serious issue and Failure mode 1 from the original review are closed. Overall batch score moves from 7/10 to
  8/10: the one substantive gap is fixed with direct, real-wiring test coverage rather than another layer of
  fakes, and the Minor lint nit is resolved as a side effect.
