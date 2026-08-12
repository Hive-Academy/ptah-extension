# Context — TASK_2026_195

## How this surfaced

Found while answering a question during TASK_2026_187 (webview bundle splitting):
_"we had an issue when working in 2 different workspaces that causes issues when
routing between working sessions — for example canvas in one workspace and
tribunal in another. Does the bundle change relate to it?"_

The bundle change does not. But the investigation located the mechanism, so it is
recorded here rather than lost. **This is deliberately out of TASK_2026_187's
scope** — that task is a bundle refactor and must not absorb a state-scoping fix.

## Re-verification (2026-08-10)

Checked against HEAD after `libs/frontend/core` and the webview shell were
refactored for lazy view loading (TASK_2026_187). Result:

- **Scope item 1 (global `currentView` / `layoutMode` / `_openViews`) — HOLDS.**
  Line numbers below are unchanged by the lazy-view work, and
  `workspace-coordinator.service.ts` still contains no reference to
  `AppStateManager` at all.
- **Scope item 2 (canvas / tribunal) — DOES NOT HOLD. Dropped.** See the
  corrected section below.
- **Scope item 3 (unchecked `switchGeneration`) — HOLDS.** Still exactly as
  described: captured at `switchWorkspace`, passed only to
  `refreshWorkspaceProviderState`, never re-checked after the `await` in the
  editor-services loop.
- **Scope item 4 (audit the other view-owning libs) — not re-checked**, and
  worth doing with the corrected pattern in mind.

Status stays `backlog`; the task is still real, it is just smaller than written.

## The shape of the problem

Session state is workspace-partitioned. View state is not.

`WorkspaceCoordinatorService.switchWorkspace`
(`libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:92-120`)
switches exactly four things:

```
this.tabManager.switchWorkspace(newPath);
this.sessionLoader.switchWorkspace(newPath);
// then, after an awaited dynamic import:
EditorService | GitStatusService | GitBranchesService | TerminalService
  .switchWorkspace(newPath)
```

It touches nothing else. In particular:

- **`currentView` is a global singleton** —
  `libs/frontend/core/src/lib/services/app-state.service.ts:164`
  (`private readonly _currentView = signal<ViewType>('chat')`), exposed at `:233`.
- **`layoutMode` is a global singleton** — same file, `:171` / `:241`, defaulting
  to `'grid'` and restored from `localStorage` (`ptah-layout-mode`) at `:331-335`.
- **`_openViews`** (the Electron navbar tab pills, `:170`) is likewise global.

So after a workspace switch the shell is still showing whatever view and layout
mode the _previous_ workspace was in, now pointed at the new workspace's sessions.

## The two surfaces named in the report — CORRECTED 2026-08-10

> **The original text of this section was wrong, and it was wrong in the
> direction that costs the most time: it described canvas and tribunal as
> unpartitioned when both had already been fixed.** It has been rewritten below
> against HEAD. Do not start this task from the premise that canvas or tribunal
> state leaks across workspaces — verify first, because it does not.

**Canvas — already workspace-partitioned. Not a defect.** `CanvasStore` is still
`@Injectable()` scoped per `OrchestraCanvasComponent` rather than
`providedIn: 'root'`, but that no longer implies a shared tile set, because the
store partitions internally. It holds signal-backed per-workspace maps —
`_workspaceTiles`, `_workspaceFocusedTabId`, `_activeWorkspacePath`,
`_workspacePaths`, `_workspaceRecency`
(`libs/frontend/canvas/src/lib/canvas.store.ts:68-79`) — and the public `tiles` /
`focusedTabId` are computeds over the active workspace's entry (`:91-93`). The
switch entry point is `switchWorkspaceTiles(newPath, activeTabs)` at
`canvas.store.ts:227`, which flips the active path, seeds a workspace the first
time it is visited, and migrates tiles created under the pre-bootstrap sentinel
key (`IMPLICIT_WORKSPACE_PATH`, `:38`) into the first real workspace. There is
also a keep-alive cap on how many workspace grids stay mounted, with tile
positions surviving unmount (`:22-24`). It **is** driven on switch:
`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:323` is the sole
caller. Landed in `f3877753b perf(webview): keep canvas tiles alive across
workspace switches`.

**Tribunal — already workspace-keyed. Not a defect.** `TribunalStateService`
(`libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.ts`) keeps
one run slice per workspace path, keyed by workspace or by the same
pre-bootstrap sentinel (`:29-30`, `:72`), and exposes the active slice as a
computed (`:85-87`). It seeds `_activeWorkspacePath` from
`TabManagerService.activeWorkspacePath` at construction to avoid a bootstrap
migration (`:114-116`), keeps the pointer synced through an effect on
`activeWorkspacePath$` (`:119-126`), and drops a slice when a workspace is
removed, using a monotonic `seq` so each `removedWorkspace$` emission deletes
exactly once (`:81-83`, `:129-136`). Background spawns are written into their own
run's slice rather than the active one (`:145-146`). Landed across
`ef32f9c4b fix: sync all pages to the active workspace with per-workspace state`
and `88f68ea53 fix: harden workspace scoping from dual code review`.

**The mechanism they used is the important part.** Neither service registers
with `WorkspaceCoordinatorService`. Both observe `TabManagerService`'s active
workspace signal directly and partition their own state behind an unchanged
public API. That is a different pattern from the `WorkspaceAwareService` /
`switchWorkspace(newPath)` push used by the editor services, and it is the
pattern to copy for anything remaining — it needs no registration step, so it
cannot be forgotten the way registration can.

## Secondary finding — unchecked generation guard

`switchWorkspace` captures a monotonic generation at line 93:

```ts
const generation = ++this.switchGeneration;
```

but only passes it to `refreshWorkspaceProviderState(generation)` at line 119. The
editor-services loop at lines 98-101 runs **after an `await`** and never re-checks
it:

```ts
const services = await this.resolveEditorServices();
for (const svc of services) {
  svc.switchWorkspace(newPath); // no generation check
}
```

On a rapid A→B→A switch two calls are in flight concurrently and the older one can
apply last, leaving the editor services on the stale path while chat is on the new
one. In practice the window is small — `resolveEditorServices` memoises
(`:70-72`), and after TASK_2026_187 Batch 1 the import target
(`@ptah-extension/editor/services`) resolves a 320-byte facade over an eager
chunk, so it is one microtask — but the guard is written and then not used, which
is the kind of thing that gets wider later, not narrower.

## Scope to investigate

1. Should `currentView` / `layoutMode` / `_openViews` be workspace-partitioned, or
   should a workspace switch reset them to a defined state? Partitioning matches
   the existing `TabManagerService` / `GitStatusService` precedent; resetting is
   simpler and may be what users actually expect. This is a product decision, not
   only a technical one — decide it explicitly before implementing.
2. ~~Register `CanvasStore` and `TribunalStateService` with
   `WorkspaceCoordinatorService`.~~ **DROPPED — verified 2026-08-10, this item
   was written from a stale reading and there is nothing here to do.** Both
   services are already workspace-partitioned, and they got there by observing
   `TabManagerService`'s active-workspace signal instead of by registering with
   the coordinator; see the corrected section above for the file:line evidence.
   Registering them now would give them a second, redundant switch trigger.
   Anything this task does add should follow that same observe-the-signal
   pattern rather than the `WorkspaceAwareService` push.
3. Apply the captured `generation` to the editor-services loop.
4. Audit the other view-owning services for the same gap — the four Thoth tab
   libs, `tasks-ui`, `marketplace`.

## Notes

- Reproduce first, then fix. The report is second-hand and the exact symptom
  ("routing between working sessions") should be pinned to a concrete sequence
  before any code changes.
- ~~TASK_2026_187 Batch 2 makes `OrchestraCanvasComponent` lazy, which moves
  `CanvasStore`'s construction from shell-init to first canvas activation.~~
  **STALE — corrected 2026-08-10.** Batch 2 _did_ defer the canvas, but it was
  **reverted** before landing: deferring it cost +70–100 ms of Electron startup
  TTI, because `ElectronShellComponent` forces grid layout on every launch, which
  makes the canvas Electron's launch surface. `OrchestraCanvasComponent` is
  **eager**, and `CanvasStore` still constructs at shell-init exactly as before —
  construction order relative to a workspace switch is unchanged, so there is
  nothing here for this task to work around. See TASK_2026_187 `tasks.md`, the
  ❌ RESOLVED block and risk row R15.
- What TASK_2026_187 _did_ land that touches this area: `marketplace`,
  `tribunal-panel`, `thoth-shell` (with its four tab libs), `tasks-ui` and
  `harness-builder` are now loaded from lazy chunks. Their services stay eager via
  narrow `/services` barrels. If item 4 below audits those libs, note their
  components now mount later than they used to.
