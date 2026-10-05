# TASK_2026_612_0332 — defect 2 of 2: child session gets no Orchestra Canvas tile

All paths are in the worktree `D:/projects/ptah-extension/.claude-worktrees/task-612-child-session-visibility`.
Line numbers are the post-change state unless noted "(pre-change)".

## Adoption trace (step list with file:line)

1. **Backend → webview.** The backend pushes `agentSession:opened` (or answers `chat:agent-sessions` on bootstrap/workspace switch) with an `AgentSessionOpenedPayload` — contract in `libs/shared/src/lib/types/messages/agent-session.ts:10-30`.
2. **Message handler.** `ChatMessageHandler.handleAgentSessionOpened` parses the payload and calls `agentSessionAdoption.adopt(parsed, 'live')` — `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:198` (message-type switch), `:209-220` (parse + adopt).
3. **Adoption service.** `AgentSessionAdoptionService.adopt()` (`libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts:242-261`) calls `TabManagerService.adoptAgentSessionTab(descriptor, mode)`; `adoptLiveChildren()` (`:200-234`) does the same for every descriptor in one `chat:agent-sessions` result (a synchronous loop → bursts are possible).
4. **Tab manager.** `adoptAgentSessionTab` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:912-951`) inserts the child directly after the parent **into the parent's workspace partition** (`workspacePartition.addTabToWorkspace`, `:944-950`; into the plain active tab set when no partition is active, `:929-941`). It never changes the active tab and notifies nobody — only `saveTabState()` (localStorage).
5. **Canvas tile decision.** `OrchestraCanvasComponent`/`CanvasStore` create tiles only from:
   - its own creation flows — `CanvasStore.addTile` (`libs/frontend/canvas/src/lib/canvas.store.ts:203-211`), `addTileFromSession` (`:180-195`);
   - **first-visit hydration** — `hydrateWorkspace` (`:387-453`) → `reconcileIntent` (`libs/frontend/canvas/src/lib/canvas-layout-intent.ts:261-284`), which appends default tiles only for tab ids **present in `authoritativeTabIds` at hydration time** (canvas constructor: `orchestra-canvas.component.ts:334-338`; per-path first visit on workspace switch: `switchWorkspaceTiles`, `canvas.store.ts:369-378`);
   - the **F-D3 signal bridge** — `AppStateManager.requestCanvasTab` (pre-change single-slot, `app-state.service.ts:1291-1298`) drained by the canvas effect (pre-change `orchestra-canvas.component.ts:412-421`), used in production only by the Tasks-board launch (`libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:75-78`);
   - notification focus requests (`requestCanvasFocus`, `app-state.service.ts:1228-1258` → `processFocusRequest`, `orchestra-canvas.component.ts:465-528`).
6. **Result.** A child adopted while the canvas is already mounted and the active workspace path is already hydrated lands in the tab manager (tab bar/sidebar fine) but matches **none** of the tile-creation paths above → no tile.

## Root cause

Adoption bypasses every tile-creation path the canvas has. `adoptAgentSessionTab` inserts the tab silently; the canvas tiles only tabs it created itself, tabs that already existed at first-visit hydration, or tabs pushed through the `requestCanvasTab` signal bridge — and no code on the adoption path called that bridge. Secondary defect in the same bridge: it was a **single-slot signal**, so a burst of requests (late adoption of several children from one `chat:agent-sessions` result) would have been coalesced by Angular's effect flush to only the last request.

## Changes

- `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts`
  - `:2` import `AppStateManager` (chat → core, an established direction: same file already imported `ClaudeRpcService`; `task-prompt-bridge.service.ts` already injects `AppStateManager`).
  - `:111` `private readonly appState = inject(AppStateManager);`
  - `:253` after an `'adopted'`/`'exists'` outcome: `this.requestCanvasTile(descriptor)`.
  - `:275-287` `requestCanvasTile()`: only in `layoutMode() === 'grid'` (mirrors `task-prompt-bridge.service.ts:75`); skips children that landed in a **background** partition (`findTabByIdAcrossWorkspaces(...).workspacePath !== null`), because `CanvasStore.adoptTab` appends to the canvas's *active* grid; otherwise queues `requestCanvasTab(tabId, label, /* focus */ false)`.
- `libs/frontend/core/src/lib/services/app-state.service.ts`
  - `:229-247` `CanvasTabRequest` gains optional `focus?: boolean` (absent ⇒ focus, preserving F-D3 launch behavior).
  - `:446-464` `_canvasTabRequest` (single slot) → `_canvasTabRequests` **FIFO queue**, mirroring `_canvasSessionRequests` (which the repo already queue-ified for exactly this burst reason — see its comment at `:1180-1185`).
  - `:688` `canvasTabRequests` readonly signal (replaces `canvasTabRequest`).
  - `:1302-1314` `requestCanvasTab(tabId, name?, focus?)` pushes onto the FIFO.
  - `:1317-1323` `takeCanvasTabRequests()` returns all pending in FIFO order and empties the queue (replaces `clearCanvasTabRequest`; no consumers of the old names remain — verified by grep).
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`
  - `:403-428` the F-D3 effect now **drains the whole queue in one pass** (`untracked(() => takeCanvasTabRequests())`), calls `CanvasStore.adoptTab` per request (dedup + tile cap stay in the store), and focuses only when `req.focus !== false`.

Dependency direction: no new lib-to-lib edges (chat→core and canvas→core both pre-existed); `chat-ui` untouched; `libs/shared` and `libs/backend` untouched.

## Tests added

- `libs/frontend/chat/src/lib/services/agent-session-adoption.service.spec.ts` — new `describe('canvas tile request (TASK_2026_612)')`:
  - grid layout: adopting a child queues **exactly one** request `(tabId, label, false)`;
  - single layout: adoption never queues (tile logic untouched in non-canvas layout);
  - a settled child re-adopted on the same page queues no second request;
  - an `'exists'` child (re-adoption on webview bootstrap) queues exactly one — the canvas's `adoptTab` dedup keeps it one tile;
  - `parent-absent` / `invalid` / throwing adoptions queue nothing;
  - a child in the active tab set (VS Code panel, no partition) is requested; a child that landed in a **background partition** is not (wrong-grid guard).
- `libs/frontend/core/src/lib/services/app-state.service.spec.ts` — F-D3 tests rewritten for the queue: FIFO order + `takeCanvasTabRequests` empties it; `focus: false` is recorded only when asked.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts` — harness converted to the queue shape; F-D3 tests updated (adopt+focus+drain; no focus on cap refusal); new test: **a burst of two queued agent-child requests is drained in one tick, both adopted in FIFO order, no focus steal**.
- `libs/frontend/canvas/src/lib/canvas.store.spec.ts` — store-level pin: `adoptTab` of an already-tiled tab adds no second tile (re-adoption never doubles a tile).

## Verification

Command (from the worktree root):

```
npx nx run-many -t typecheck,test,lint -p @ptah-extension/core,@ptah-extension/canvas,@ptah-extension/chat --parallel=2
```

Tail of output:

```
 NX   Running targets typecheck, test, lint for 3 projects:

- @ptah-extension/core
- @ptah-extension/canvas
- @ptah-extension/chat

√  nx run @ptah-extension/core:typecheck
√  nx run @ptah-extension/core:test
√  nx run @ptah-extension/core:lint
√  nx run @ptah-extension/chat:typecheck
√  nx run @ptah-extension/chat:test
√  nx run @ptah-extension/chat:lint
√  nx run @ptah-extension/canvas:typecheck
√  nx run @ptah-extension/canvas:test
√  nx run @ptah-extension/canvas:lint

 NX   Successfully ran targets typecheck, test, lint for 3 projects
```

Projects changed & verified: `@ptah-extension/core`, `@ptah-extension/chat`, `@ptah-extension/canvas` — **PASS** (9/9 tasks, exit code 0; 1m46s). No daemon/lock retry was needed. (The trailing "Nx Cloud … FREE plan" notice is org-level noise, unrelated to the run.)

## Manual repro steps for a screenshot

1. Open the extension webview on a workspace, switch the layout to **Orchestra Canvas** (grid) and make sure the canvas has been shown once (it hydrates on first view) with the parent conversation open as a tile.
2. In the parent conversation, ask the agent to start a child, e.g. *"start a child session with label 'demo child'"* → the parent runs `ptah_session_start`.
3. Within a second the grid gains a new tile labeled with the child's label (task prompt as its first user turn, then live streaming). The focused tile (the parent) keeps focus — the active tab does not change.
4. Reload the webview panel while the child is still live: bootstrap `chat:agent-sessions` re-adopts the child; the child still has **exactly one** tile.
5. Screenshot: canvas grid showing the parent tile mid-turn plus the new child tile streaming.

## Not done / risks

- Defect (1) — sidebar "transcript expired" — is backend-side (`session-rpc.handlers.ts`); out of scope for this lane (`libs/backend` untouched, another lane owns it).
- Pre-existing gap, now consistent with the notification mechanism's own behavior: a child adopted into a **background workspace partition** while the canvas shows a different workspace gets its tile from first-visit hydration when the user switches there; if that workspace's grid was already hydrated earlier in the same page lifetime, the tile only appears after a reload. Same shape as `requestCanvasFocus` resolving `missing` for a non-active workspace.
- Tile-cap refusal (`MAX_CANVAS_TILES = 20`): the child stays in the tab bar/sidebar — the F-D3 KNOWN GAP (refusal not reported back to the caller, `orchestra-canvas.component.ts:403` comment) applies to adoption too.
- F-D3 launch behavior (Tasks board → tab created, tile **focused**) is intentionally unchanged; adoption uses `focus: false` so a background child never steals the active tab, matching `adoptAgentSessionTab`'s "never changes the active tab" contract.
- `CanvasTabRequest.name` is still unused by the drain effect (pre-existing); left as-is to avoid scope creep.
- No Playwright e2e was run (not requested); coverage is the Jest specs above plus typecheck/lint.

## Revision 1

Orchestrator review defect: the revision-0 gate `if (!landed || landed.workspacePath !== null) return;` matched only `workspacePath: null`. But `TabWorkspacePartitionService.findTabByIdAcrossWorkspaces` (`libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:332-338`) reports the **active partition's path** for a tab in the active tab set — non-null whenever a workspace is active — and `null` only when no workspace is active. In the Electron host (always an active workspace) the gate therefore dropped every request and the bug stayed unfixed there.

### Fix (file:line)

- `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts:282-299` — the gate now requests a tile only when the child landed in the partition the canvas is showing: `landed.workspacePath === this.tabManager.activeWorkspacePath` (public getter, `libs/frontend/chat-state/src/lib/tab-manager.service.ts:766-767`). `null === null` keeps the VS Code panel (no active workspace) working; an active workspace matches only its own partition; a background partition (`'/ws/other'` ≠ active) stays excluded. The inline comment (`:286-290`) and the doc paragraph (`:274-281`) were corrected to the real semantics.

### Tests (file:line)

- `libs/frontend/chat/src/lib/services/agent-session-adoption.service.spec.ts` — the fake TabManager gained `activeWorkspacePath` (declaration `:50-57`, mock value `:70`); the grid-layout describe now covers all three placement cases:
  - `:257-261` — active `null`, child landed in the only tab set (`null`) → one request — kept (VS Code panel);
  - `:263-278` — **Electron regression**: active workspace `/ws/a`, child landed in `/ws/a` → exactly one request, `(tabId, label, false)`;
  - `:280-290` — active `/ws/a`, child landed in `/ws/other` (background partition) → no request.

### Verification

Command (worktree root):

```
npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat --parallel=2
```

Tail of output:

```
 NX   Running targets typecheck, test, lint for project @ptah-extension/chat:

- @ptah-extension/chat

√  nx run @ptah-extension/chat:typecheck
√  nx run @ptah-extension/chat:test
√  nx run @ptah-extension/chat:lint

 NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/chat
```

**PASS** — typecheck, test, lint for `@ptah-extension/chat`, exit code 0 (51.9s). This revision touched only the two files above; no other project or file changed.

## Revision 2

Code-logic review finding 3: the request was queued when `layoutMode() === 'grid'`, not when the canvas is actually mounted, and the queue keeps requests until drained. With the user on another view (canvas not mounted), a child is adopted, the user switches workspace and then opens the chat view: the freshly mounted canvas drains the stale request and calls `adoptTab` on the NEW workspace's grid for a tab of the OLD workspace.

### Fix (file:line)

- `libs/frontend/core/src/lib/services/app-state.service.ts:247` — `CanvasTabRequest` now carries a **required** `workspacePath: string | null` (null: the single tab set, VS Code panel), captured at request time; `requestCanvasTab(tabId, workspacePath, name?, focus?)` (same file) takes it as its second parameter. The field is required on purpose: both production callers were updated in the same change, so a caller cannot silently omit the workspace and regress into the unguarded behavior — no optional-field escape hatch is needed to keep the Tasks-board launch identical.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:429` — the drain effect drops (not keeps) any request whose `workspacePath` differs from the canvas's current active workspace: `if ((req.workspacePath ?? '') !== activeWorkspacePath) continue;`. `null` normalizes to `''`, matching the canvas's implicit partition (`ensureActivePath`'s `?? IMPLICIT_WORKSPACE_PATH`), so the VS Code panel keeps working. Focus behavior unchanged.
- `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts:302` — the adoption request passes `landed.workspacePath` (the partition the child actually landed in, already equality-checked against the tab manager's active workspace by the revision-1 gate).
- `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:83` — the Tasks-board launch request passes `this.tabManager.activeWorkspacePath`, the workspace `createTab` just put the fresh tab into. Same-workspace launch behavior is identical; a stale cross-workspace launch request is dropped exactly like an adoption request (same defect class).

### Tests

- `libs/frontend/core/src/lib/services/app-state.service.spec.ts` — the queue tests now record/expect `workspacePath` (`'/ws/a'` and `null`) in the FIFO and `focus: false` shapes.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts` — new: *drops a tab-adoption request for a workspace the canvas is not showing* (request `/ws/a`, canvas active `/ws/b` → `adoptTab` never called, queue still fully drained); new: *adopts exactly one tile for a same-workspace request* (request `/ws/a`, canvas active `/ws/a` → `adoptTab` once, no focus steal). The existing F-D3, cap-refusal and burst tests carry `workspacePath: null` (implicit partition).
- `libs/frontend/chat/src/lib/services/agent-session-adoption.service.spec.ts` — the grid-layout expectations assert the full 4-argument call: `('c1', null, 'X', false)` (VS Code) and `('c1', '/ws/a', 'X', false)` (Electron).
- `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.spec.ts` — the F-D3 expectation updated to `('tab-1', null, 'TASK_2026_300')` (signature change); new *carries the active workspace path on the canvas tile request (stale-drop support)* asserting `('tab-1', '/ws/a', 'TASK_2026_304')`; the fake TabManager gained an `activeWorkspacePath` getter. All other bridge behavior (single layout: no request; prefill targeting) unchanged and still green.

### Verification

Command (worktree root; project list uses the full nx names — `core`/`canvas`/`chat` are not the nx project names, `@ptah-extension/*` are):

```
$env:NX_NO_CLOUD='true'; $env:NX_DAEMON='false'; npx nx run-many -t typecheck,test,lint -p @ptah-extension/core,@ptah-extension/canvas,@ptah-extension/chat --parallel=2
```

Tail of output:

```
√  nx run @ptah-extension/chat:typecheck
√  nx run @ptah-extension/chat:test
√  nx run @ptah-extension/chat:lint
√  nx run @ptah-extension/canvas:typecheck
√  nx run @ptah-extension/canvas:test
√  nx run @ptah-extension/canvas:lint

 NX   Successfully ran targets typecheck, test, lint for 3 projects
```

**PASS** — typecheck, test, lint for `@ptah-extension/core`, `@ptah-extension/canvas`, `@ptah-extension/chat` (9/9 tasks, exit code 0, 1m35s; `@ptah-extension/core`'s three tasks passed earlier in the same run). Nothing outside the four files (and their specs) above changed.
