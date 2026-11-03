# Batch 9 report: renderer side of the detached Display window

## Files

- CREATED `libs/frontend/chat/src/lib/services/display-window/display-window-wire.ts`: pure wire module.
  - `DisplayWindowView`: what the panel needs. It holds the theme `{name, mode}`, `open`, `pinned`,
    `count`, `selectedKey`, `scrollToSelectedOnMount`, `fullscreenArtifactId`, `summary`,
    `summaryTurnKey`, `surfaces`, `viewStates`, `artifacts` and `actionError`.
  - `toWire(view)` produces a JSON object with `version: 1`. Maps become `[k, v]` arrays and Sets
    become arrays (`componentSignatures`, `retainedViewStateIds`, `viewStates`). A generic
    `toJsonValue` drops `undefined` and functions and turns non-finite numbers into `null`.
  - `parseWireState(raw)` is async. It validates the snapshot with a strict Zod schema. The
    `ArtifactRecordSchema` is lazy-imported from `@ptah-extension/shared/mcp-apps-contracts` (the
    `artifact.store.ts` pattern) and the schema is cached. It rebuilds the Maps and Sets and returns
    `null` when the snapshot is invalid.
  - `parseActionPush(payload)` is sync and uses Zod (discriminated union of the six action types,
    strict). `view-state` is validated as `SurfaceViewState`. `actionToWire(tabId, action)` builds the
    push payload.
  - `selectionKey` and `selectionForKey` map panel strip keys to dock selections.
    `utf8ByteLength` is used for the 4 MiB cap.
- CREATED `.../display-window/display-window-wire.spec.ts`: covers key round trips and
  `toJsonValue`. It runs a full view → JSON text → parse round trip and checks six refusal cases
  (unknown version, extra field, bad theme name, bad artifact, unknown surface contract, summary
  without cards). It also covers an empty tab id and null, action accept and refuse cases, and the
  UTF-8 byte count.
- CREATED `.../display-window/display-window-sync.service.ts`: `DisplayWindowSync` (providedIn root,
  `MessageHandler`).
  - Signals `detached` and `error`, plus `count` for the main view's detached rail.
  - `detach()` and `focus()` call `displayWindow:open`. `attach()` calls `displayWindow:close`.
    `desktop-only` and `not-ready` map to user text in `error`.
  - `bindSource({tabId: Signal<string|null>, dock}): () => void`. The returned unbind clears the
    binding only if it is still that source.
  - While detached, one effect reads the computed view (dock tab state, `summaryFor`,
    `summaryKeyFor`, `fullscreenArtifact`, `ArtifactStore.panelArtifacts(tabId, selected)`,
    `ThemeService.currentTheme` / `isDarkMode`, change-set action errors). It schedules one
    `requestAnimationFrame` at a time. The frame publishes `displayWindow:publishState
    {tabId, revision, state}` only if the JSON text changed, and refuses (with `error`) when the
    text is over `DISPLAY_WINDOW_STATE_MAX_BYTES`. The pending frame is cancelled on attach and on
    destroy. A failed publish clears the "last published" marker so the next change retries.
  - Handles `displayWindow:closed` (attaches) and `displayWindow:action`. The action payload is
    Zod-validated and applied only when `tabId === bound tabId()`:
    - `select` → `dock.select`
    - `fullscreen-closed` → `clearFullscreenArtifact`
    - `view-state` → `setViewState`
    - `open-file` / `review` → `ChangeSetActionsService` on the shown summary's change set. A
      missing change set or a thrown error becomes `actionError` in the next snapshot.
    - `attach` → `attach()`.
  - On Electron the constructor calls `displayWindow:status`. `{supported, open}` restores
    `detached` after a main-renderer reload.
- CREATED `.../display-window/display-window-sync.service.spec.ts` (13 tests): status restore, no
  status outside Electron, one publish per frame and only on change (two changes in one frame give
  one publish with revision 2), nothing while attached, `desktop-only`, the size cap, the closed
  push, bound-tab-only actions, an invalid action, `fullscreen-closed`, `attach`, review with no
  change set, and unbind.
- CREATED `libs/frontend/chat/src/lib/components/templates/display-window/display-window.component.ts`:
  `DisplayWindowComponent` (`ptah-display-window`, standalone, OnPush, signals, `inject()`).
  - Header "Display · N" with a Re-attach button. Before any snapshot, Re-attach calls
    `displayWindow:close`, since no tab id is known yet.
  - `<ptah-display-panel>` inside `@defer (on immediate)`, with placeholder and error blocks. A
    "Waiting for the main window…" status shows until the first snapshot.
  - Panel outputs become `displayWindow:action`. `openExternal` goes through `artifacts:openLink`
    with a 5 s error notice. `retryArtifacts` pulls `getState` again.
  - An effect sets `data-theme` and `data-theme-mode` on `<html>` from the snapshot.
- CREATED (not in the batch list) `.../templates/display-window/display-window-state.handler.ts`:
  `DisplayWindowStateHandler` (`MessageHandler` for `displayWindow:state`, providedIn root but
  injected only by the child).
  - `load()` pulls `displayWindow:getState`. Pushes replace the snapshot.
  - A `getState` reply that resolves after a push is dropped, and a later push supersedes an earlier
    one whose parse finishes late.
  - An invalid snapshot keeps the previous one and sets `error`.
  - The plan names this class (D4), and batch 10's config needs it as a separate provider, so it got
    its own file instead of sharing the component file.
- CREATED `.../templates/display-window/display-window.component.spec.ts` (10 tests, stub panel like
  `display-sheet.component.spec.ts`): boot pull and render, theme attributes, a push replaces the
  snapshot, the waiting state, an invalid snapshot error, all panel outputs → actions for the
  snapshot tab, a link refusal, Re-attach with and without a snapshot, and Retry.
- MODIFIED `libs/frontend/chat/src/index.ts`: exports `DisplayWindowSync`, `DisplayWindowSource`,
  `DisplayWindowComponent` and `DisplayWindowStateHandler`.
- MODIFIED `apps/ptah-extension-webview/src/app/app.config.ts`: `DisplayWindowSync` import plus
  `{ provide: MESSAGE_HANDLERS, useExisting: DisplayWindowSync, multi: true }` next to
  `ArtifactMessageHandler`.

## Decisions

- **Depth of validation for nested renderer models.** The envelope, theme, strip state, artifacts
  (the real `ArtifactRecordSchema`), view states and actions are strict Zod schemas. Surface
  `content` and the summary model are `z.custom` guards: plain JSON, plus the contract tag and
  variant shape, or the summary flags and a card list with `kind`. Re-running the full surface
  validator in the child would duplicate the main renderer's validation and pull the large surface
  schema chunk. The data comes only from the trusted main renderer through the host's 4 MiB strict
  handler. The declarative renderer and summary bind text only (no HTML). Reversible: swap in
  `validateSurfaceDocument` later if needed.
- **Theme name** is restricted to `^[a-z][a-z0-9-]{0,63}$` before it becomes an attribute value.
- **Revision** is one counter per `DisplayWindowSync`, so it only grows for any tab. The child does
  not compare revisions, because a main-renderer reload resets the counter. Ordering comes from IPC
  push order plus the "getState older than a push" rule.
- **Child Retry** (`retryArtifacts`) re-pulls the cached snapshot. The child has no
  `ArtifactStore`, and there is no action type for a main-side `reload`. Reversible: add an action
  type if needed.
- **`ChangeSetActionsService` is resolved lazily** in the sync, so app boot does not construct it
  for this handler.
- `zod` is imported statically in the wire module. It is already eager in the webview, through
  `chat-state/tab-persistence.ts` and `chat-attention-host-message-handler.service.ts`. Only
  `mcp-apps-contracts` stays lazy.

## What batches 10 and 11 must wire

- **Batch 10 (child config):**
  - Provide `ClaudeRpcService` and the message router with
    `{ provide: MESSAGE_HANDLERS, useExisting: DisplayWindowStateHandler, multi: true }` and
    `ClaudeRpcService` as a handler.
  - Bootstrap `DisplayWindowComponent` (selector `ptah-display-window`, so `index.html` needs that
    element or the bootstrap must target it).
  - Do NOT provide or inject `DisplayWindowSync`. The child's IPC allowlist has no `status` or
    `publishState`.
  - Themes outside the four eager ones need `theme-extra.css` in the child. The component sets only
    the attributes (data-glass / accent attributes are not mirrored).
- **Batch 11 (ChatView):**
  - In the main ChatView only (not tiles or the command center), call
    `displayWindowSync.bindSource({ tabId: <active tab signal>, dock })` and unbind on destroy.
  - While `detached()`, render the narrow rail "Display · {{ count() }} (separate window)" with
    Focus (`focus()`) and Re-attach (`attach()`). Show `error()`.
  - Detach button → `detach()`.
  - The display sheet can use `selectionKey` / `selectionForKey` from `display-window-wire.ts`
    instead of its private copies (optional).

## Verification

### Fix of the 3 failing sync tests (spec bug, service unchanged)

Three tests failed: "publishes once per frame", "refuses a snapshot over the size cap" and "review
without a change set". In all three the publish frame never ran.

Root cause: the chat tests are zoneless (`setupZonelessTestEnv`). Angular's zoneless change
detection scheduler races `setTimeout` against `requestAnimationFrame` and cancels its own losing
frame with `cancelAnimationFrame`. The spec's `cancelAnimationFrame` mock ran `frames = []`, which
dropped every queued frame. So the scheduler cleanup inside `TestBed.tick()` also dropped the
service's publish frame. The service code is correct.

Fix: in `display-window-sync.service.spec.ts` only, the mock keeps frames in a `Map<id, callback>`
and `cancelAnimationFrame(id)` deletes only that id.

### Results

- `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns=display-window-sync`:
  before the fix 3 failed and 10 passed. After the fix: pass (13/13).
- `npm run verify -- -p @ptah-extension/chat,ptah-extension-webview` (lint, test, typecheck; 6 tasks):
  4 passed and 2 failed.
  - `@ptah-extension/chat:typecheck` and `:lint` pass. `ptah-extension-webview:test` and
    `:typecheck` pass.
  - `@ptah-extension/chat:test`: 5380 passed, 2 skipped, 1 failed. The failure is in
    `molecules/agent-card/stdout-visibility.spec.ts` ("keeps a peer message visible after stream
    events"), which no batch touched. Re-run alone
    (`-t test -p @ptah-extension/chat -- --testPathPatterns=stdout-visibility`) it passes.
    Treated as a flake under full-suite load. The same run also reported "A worker process has
    failed to exit gracefully".
  - `ptah-extension-webview:lint`: the only error is the known pre-existing circular dependency
    `app.routes.ts` / `command-center/.../scene-contrast.spec.ts`. Left unfixed as instructed.
