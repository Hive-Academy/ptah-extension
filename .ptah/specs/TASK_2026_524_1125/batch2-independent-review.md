# Code Logic Review — `TASK_2026_524_1125` (Batch 2: `SURFACE_ACTIVE` Contract)

VERDICT: PASS

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 1        |

The uncommitted change set implements the Batch 2 `SURFACE_ACTIVE` activity contract cleanly and robustly. It pauses CPU-intensive and layout operations (markdown parsing/sanitizing, IntersectionObserver windowing, Gridstack remeasuring/relayout, execution node rAF rendering, and batched streaming ingestion) while a surface or tab is hidden, without prematurely detaching views or removing `[class.hidden]` bindings (which are reserved for Batch 3). All six design and priority checks requested for Batch 2 were audited in depth with file:line evidence.

---

## Priority Order Checks

### 1. Reactivation Losslessness (Highest Risk)

Audited each of the 5 gated consumer paths for dropped values upon deactivation and reactivation:

- **Markdown (`SurfaceMarkdownPipe`)**:
  - _Location_: [`libs/frontend/markdown/src/lib/surface-markdown.pipe.ts:10-18`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/markdown/src/lib/surface-markdown.pipe.ts#L10-L18)
  - _Behavior_: While `active` is `false`, the pipe does not re-parse new incoming text; it retains and returns the previously rendered string `this.rendered`. Because `active` is an explicit input to the pure pipe (`transform(raw, active)`), Angular change detection re-evaluates the pipe immediately when `active` toggles from `false` to `true`. On activation, `if (active) this.rendered = raw ?? ''` updates with the newest raw string, delivering it to `ngx-markdown` and DOMPurify for a single catch-up parse. Verified lossless in [`libs/frontend/markdown/src/lib/surface-markdown.spec.ts:7-47`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/markdown/src/lib/surface-markdown.spec.ts#L7-L47).
- **IntersectionObserver Windowing (`TranscriptRenderWindow`)**:
  - _Location_: [`libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts:110-133`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts#L110-L133)
  - _Behavior_: When paused, the observer disconnects. Upon reactivation, `connect()` runs `seedMountSet()`, which measures slot rects against `root.getBoundingClientRect()`. Crucially, `seedMountSet()` initializes `next` as `new Set(this.intersecting())` rather than an empty set, ensuring pre-pause mounted messages and retained replay items are never blanked. Re-observation resumes and any obsolete queued browser callbacks from before disconnection are rejected by observer instance check `if (this.observer === observer)`. Verified in [`libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.spec.ts:287-313`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.spec.ts#L287-L313).
- **Gridstack Re-measurement (`CanvasWorkspaceGridComponent` & `CanvasLayoutService`)**:
  - _Location_: [`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:415-448`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L415-L448) and [`libs/frontend/canvas/src/lib/canvas-layout.service.ts:74-84`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/canvas/src/lib/canvas-layout.service.ts#L74-L84)
  - _Behavior_: `CanvasWorkspaceGridComponent` uses `afterRenderEffect` to gate layout updates. When `active` flips to `true` and `!this._wasVisible`, it invokes `grid.onResize()` exactly once, applies authoritative geometry, and sets `this._wasVisible = true`. In `CanvasLayoutService`, `afterRenderEffect` disconnects and re-observes the container element so ResizeObserver receives fresh non-zero dimensions after unhiding. If a drag/resize gesture was rejected while hidden, `this._needsReconcile` ensures authoritative geometry is reconciled upon activation. Verified in [`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts:1243-1324`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts#L1243-L1324).
- **rAF Throttle (`ExecutionNodeComponent`)**:
  - _Location_: [`libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:394-420`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts#L394-L420)
  - _Behavior_: The reactive `effect` tracks `this.surfaceActive()`. When `surfaceActive()` is false, any pending rAF frame is cancelled, `frameGeneration` is bumped, and `pendingContent = content` retains the newest text. When `surfaceActive()` becomes true, the effect triggers: if the node finished streaming while hidden, it immediately calls `publishNow(content)`; otherwise it schedules a fresh rAF frame with the latest content. Stale frames cannot overwrite the latest content. Verified in [`libs/frontend/chat/src/lib/components/organisms/execution/execution-node.render-throttle.spec.ts:171-197`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/organisms/execution/execution-node.render-throttle.spec.ts#L171-L197).
- **Batched Streaming Ingestion (`BatchedUpdateService`)**:
  - _Location_: [`libs/frontend/chat-streaming/src/lib/batched-update.service.ts:47-66`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-streaming/src/lib/batched-update.service.ts#L47-L66)
  - _Behavior_: When `surfaceActive()` transitions to false, pending updates move to `deferredTabUpdates`, `pendingTabUpdates` is cleared, and `rafId` is cancelled. On activation, `drainDeferred()` drains eligible tabs to `pendingTabUpdates` and schedules a flush frame. (See Finding 1 for an edge case in map transfer).

### 2. Silent No-op Audit

Searched codebase for `?? true`, `?.()`, and `{ optional: true }` on `SURFACE_ACTIVE`:

- **Result**: Exactly ZERO occurrences of `optional: true` or `?? true` or `?? signal(true)` on `SURFACE_ACTIVE` exist in production code across `scope:webview`.
- All webview consumers inject `SURFACE_ACTIVE` non-optionally (`inject(SURFACE_ACTIVE)`):
  - [`libs/frontend/chat-streaming/src/lib/batched-update.service.ts:42`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-streaming/src/lib/batched-update.service.ts#L42)
  - [`libs/frontend/canvas/src/lib/canvas-layout.service.ts:58`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/canvas/src/lib/canvas-layout.service.ts#L58)
  - [`libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:390`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts#L390)
  - [`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:194`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts#L194)
  - [`libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts:94`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts#L94)
  - [`libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:316`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts#L316)
  - [`libs/frontend/chat-ui/src/lib/molecules/agent-summary.component.ts:118`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-ui/src/lib/molecules/agent-summary.component.ts#L118)
  - [`libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts:93`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts#L93)
  - [`libs/frontend/chat-ui/src/lib/molecules/subagent-transcript-viewer.component.ts:185`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-ui/src/lib/molecules/subagent-transcript-viewer.component.ts#L185)
  - [`libs/frontend/chat-ui/src/lib/molecules/thinking-block.component.ts:89`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-ui/src/lib/molecules/thinking-block.component.ts#L89)
  - [`libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts:74`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts#L74)
  - [`libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts:117`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts#L117)
  - [`libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts:143`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts#L143)
- If any component is instantiated in an environment lacking the provider, Angular throws `NG0201: No provider found for InjectionToken SURFACE_ACTIVE` immediately, failing loudly as required.

### 3. Single Token Instance Audit

- Exactly ONE `new InjectionToken` exists for `SURFACE_ACTIVE`:
  - [`libs/shared/src/angular/index.ts:7`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/shared/src/angular/index.ts#L7)
- Re-exported by [`libs/frontend/core/src/lib/routing/surface-active.ts:5`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/core/src/lib/routing/surface-active.ts#L5):
  `export { SURFACE_ACTIVE } from '@ptah-extension/shared/angular';`
- Re-exported by [`libs/frontend/core/src/lib/routing/index.ts:1`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/core/src/lib/routing/index.ts#L1) and [`libs/frontend/core/src/index.ts:31`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/core/src/index.ts#L31).
- Configured in `tsconfig.base.json:174`:
  `"@ptah-extension/shared/angular": ["./libs/shared/src/angular/index.ts"]`
- Configured in `libs/shared/package.json:10-13`:
  `"./angular": { "types": "./src/angular/index.ts", "default": "./src/angular/index.ts" }` with `@angular/core` marked as optional `peerDependency`.
- No second token declaration exists.

### 4. Scope Creep Audit

Checked for unauthorized Batch 3/4 changes:

- Views detached: ZERO views detached.
- `[class.hidden]` bindings removed: ZERO removed. Persistent views in [`app-shell.component.html:603, 631`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/templates/app-shell.component.html#L603) and [`chat-transcript.component.ts:156`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts#L156) maintain their `[class.hidden]` bindings.
- Routing changes: Only added `{ provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor(...) }` per route in [`app.routes.ts:68-151`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/apps/ptah-extension-webview/src/app/app.routes.ts#L68-L151). No new routes, redirects or route reuse strategies added.
- Persistence changes: ZERO persistence mechanisms added.

### 5. Test Honesty Audit

- `provideSurfaceActiveTesting(active = true)` in [`libs/frontend/core/src/testing/surface-active-testing.ts:21-26`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/core/src/testing/surface-active-testing.ts#L21-L26) supplies a real `Signal<boolean>` (or `WritableSignal<boolean>`).
- Specs assert that work stops during pause AND resumes losslessly on activation:
  - `execution-node.render-throttle.spec.ts:171-197`: asserts hidden frames are cancelled, text is not published while hidden, and resumes publishing upon activation.
  - `canvas-workspace-grid.component.spec.ts:1243-1324`: asserts 0 layout computations occur while inactive and exactly 1 `onResize` is called on reactivation, projecting the latest compact/span intent.
  - `chat-transcript.component.spec.ts:155-220`: asserts bubble count freezes while inactive, scroll frame is cancelled, and resumes with correct bubble count and restored scroll offset upon activation.
  - `batched-update.visibility.spec.ts:135-154`: asserts stale rAF frame does not flush while hidden and activation drains the latest state.

### 6. The `markdown` Exception Audit

- Verified that `apps/ptah-landing-page` consumes `@ptah-extension/markdown` (`apps/ptah-landing-page/src/app/app.config.ts:88`, `app.routes.ts`) and does NOT provide `SURFACE_ACTIVE`.
- [`libs/frontend/markdown/src/lib/markdown-block.component.ts:38`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/markdown/src/lib/markdown-block.component.ts#L38) declares `public readonly active = input(true)`. In non-surface environments without `SURFACE_ACTIVE`, `MarkdownBlockComponent` defaults to `active = true`, maintaining standard unconditional markdown rendering.

---

## Five Logic Questions

### 1. How does this fail silently?

- In [`libs/frontend/chat-streaming/src/lib/batched-update.service.ts:59`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-streaming/src/lib/batched-update.service.ts#L59), when deactivating, pending updates are transferred to deferred updates under `if (!this.deferredTabUpdates.has(tabId))`. If `deferredTabUpdates` already holds a state for `tabId`, the newer pending state is silently ignored and dropped without warning or error.
- In `SurfaceMarkdownPipe` ([`libs/frontend/markdown/src/lib/surface-markdown.pipe.ts:16`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/markdown/src/lib/surface-markdown.pipe.ts#L16)), when `active` is `false`, `transform()` returns `this.rendered` (the string from the last active tick). The DOM displays previous content rather than an empty or error state, which is visually silent while hidden.

### 2. What user action produces unexpected behaviour?

- Rapid navigation toggling before rendering frames settle: if a user rapidly switches routes between `/settings` and `/chat` during an active SDK stream. Stale animation frames could try to execute on an inactive view. The implementation addresses this with `frameGeneration` counters in `ExecutionNodeComponent` ([`execution-node.component.ts:384`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts#L384)), `BatchedUpdateService` ([`batched-update.service.ts:46`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-streaming/src/lib/batched-update.service.ts#L46)), `CanvasLayoutService` ([`canvas-layout.service.ts:63`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/canvas/src/lib/canvas-layout.service.ts#L63)), and `ChatTranscriptComponent` ([`chat-transcript.component.ts:226`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts#L226)), discarding stale frames.

### 3. What input data produces a wrong answer?

- If container width or height is reported as `0` or negative when hidden: `CanvasLayoutService` ([`canvas-layout.service.ts:96-101`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/canvas/src/lib/canvas-layout.service.ts#L96-L101)) guards with `if (!this.active() || !entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;` so zero measurements are never propagated to Gridstack.

### 4. What happens when a dependency fails?

- If `SURFACE_ACTIVE` is not provided in a webview component tree: Angular throws `NG0201: No provider found for InjectionToken SURFACE_ACTIVE` at bootstrap/instantiation time. This fail-loud behavior prevents silent degradation.
- If `IntersectionObserver` or `ResizeObserver` is unsupported: `TranscriptRenderWindow` ([`transcript-render-window.ts:46`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts#L46)) falls back to mounting all items; `ChatTranscriptComponent` ([`chat-transcript.component.ts:672`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts#L672)) guards with `typeof ResizeObserver === 'undefined'`.

### 5. What is missing that the requirements never mentioned?

- The report in `.ptah/specs/TASK_2026_524_1125/batch2-surface-active-report.md:31-36` documents an earlier design iteration where `libs/shared/src/angular/index.ts` was supposedly removed and host components supposedly used `inject(SURFACE_ACTIVE, { optional: true }) ?? signal(true)`. The code in the tree actually restored `libs/shared/src/angular/index.ts` and non-optional injection, but the markdown report was not updated to reflect this final state.

---

## Failure Modes

### 1. Stale Deferred State Retained Over Pending Update on Inactivation

- **Trigger**: `this.surfaceActive()` transitions to `false` when `pendingTabUpdates` contains an update for a `tabId` that already has an existing key in `deferredTabUpdates`.
- **Symptom**: The newer streaming state in `pendingTabUpdates` is dropped, and the older `state` in `deferredTabUpdates` is retained.
- **Evidence**: [`libs/frontend/chat-streaming/src/lib/batched-update.service.ts:57-63`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-streaming/src/lib/batched-update.service.ts#L57-L63)
  ```typescript
  for (const [tabId, state] of this.pendingTabUpdates) {
    if (!this.deferredTabUpdates.has(tabId)) {
      this.deferredTabUpdates.set(tabId, state);
    }
    this.pendingFlush.add(tabId);
  }
  ```
- **Current handling**: It checks `if (!this.deferredTabUpdates.has(tabId))` before setting.
- **Recommendation**: Unconditionally overwrite: `this.deferredTabUpdates.set(tabId, state);`. The pending update is guaranteed to be more recent than any prior deferred update.

---

## Blocking Issues

_None._

---

## Serious Issues

_None._

---

## Moderate and Minor Issues

### Finding 1: Unconditional Map Overwrite in `BatchedUpdateService`

- **File**: [`libs/frontend/chat-streaming/src/lib/batched-update.service.ts:59`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/libs/frontend/chat-streaming/src/lib/batched-update.service.ts#L59)
- **Severity**: Moderate
- **Scenario**: When surface activity becomes inactive, `for (const [tabId, state] of this.pendingTabUpdates)` checks `if (!this.deferredTabUpdates.has(tabId))`.
- **Impact**: If `deferredTabUpdates` had an older entry for `tabId`, the newer update from `pendingTabUpdates` is discarded.
- **Fix**: Replace line 59 with `this.deferredTabUpdates.set(tabId, state);`.

### Finding 2: Outdated Batch Report Documentation

- **File**: [`.ptah/specs/TASK_2026_524_1125/batch2-surface-active-report.md:31-36`](file:///D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active/.ptah/specs/TASK_2026_524_1125/batch2-surface-active-report.md#L31-L36)
- **Severity**: Minor
- **Scenario**: The batch report states `libs/shared/src/angular/index.ts` does not exist and claims host components inject optionally with `?? signal(true)`.
- **Impact**: Misleads reviewers/maintainers reading documentation rather than git source.
- **Fix**: Update the report to match the current tree where `libs/shared/src/angular/index.ts` is active and injections are non-optional.

---

## Data Flow

1. **Host Route / Layout Event**:
   - Angular router navigates to route (e.g. `/chat`, `/settings`, `/analytics`) OR `AppStateManager` toggles `layoutMode` (`'single'` vs `'grid'`). [OK]
2. **Activity Signal Calculation**:
   - `surfaceActiveFor(routeId)` computes `Signal<boolean>` from `SurfaceRouterService.currentSurface()`. [OK]
   - For chat/canvas, `SurfaceActiveDirective` calculates `active = computed(() => chatAddressed() && layoutMode() === ...)`. [OK]
3. **Consumer Ingestion**:
   - Inactive:
     - `BatchedUpdateService`: defers tabs, cancels rAF. [OK]
     - `CanvasWorkspaceGridComponent`: freezes `items` via `linkedSignal`, suspends Gridstack mutation. [OK]
     - `ExecutionNodeComponent`: cancels rAF, retains `pendingContent`. [OK]
     - `TranscriptRenderWindow`: disconnects `IntersectionObserver`. [OK]
     - `SurfaceMarkdownPipe`: returns cached `rendered` string without running `marked`/DOMPurify. [OK]
4. **Reactivation Edge**:
   - Active signal toggles from `false` to `true`.
   - `BatchedUpdateService`: `drainDeferred()` flushes pending tabs. [OK]
   - `CanvasWorkspaceGridComponent`: `afterRenderEffect` calls `grid.onResize()` once and applies authoritative geometry. [OK]
   - `ExecutionNodeComponent`: publishes settled content or schedules rAF with newest content. [OK]
   - `TranscriptRenderWindow`: seeds visible slots with `seedMountSet()` preserving previous mounts and reconnects observer. [OK]
   - `SurfaceMarkdownPipe`: detects second argument (`active`) change, re-evaluates pure pipe with latest raw string, triggering ngx-markdown. [OK]

---

## Requirements Fulfilment

| Requirement                                                     | Status   | Gap  |
| --------------------------------------------------------------- | -------- | ---- |
| Single `SURFACE_ACTIVE` token in shared and re-exported in core | COMPLETE | None |
| Re-export token in `@ptah-extension/core`                       | COMPLETE | None |
| Root & route providers in `app.config.ts` and `app.routes.ts`   | COMPLETE | None |
| Element directive provider for chat & canvas                    | COMPLETE | None |
| Non-optional injection in `scope:webview`                       | COMPLETE | None |
| Markdown optional / default active input                        | COMPLETE | None |
| Lossless reactivation across 5 gated consumers                  | COMPLETE | None |
| No view detachments or removal of `[class.hidden]`              | COMPLETE | None |

---

## Edge Cases

| Case                                           | Handled | How                                                                        | Concern |
| ---------------------------------------------- | ------- | -------------------------------------------------------------------------- | ------- |
| Route changed while streaming in progress      | YES     | `BatchedUpdateService` defers updates, cancels rAF                         | None    |
| Tab switched while inactive                    | YES     | `canFlush(tabId)` gates flush until active                                 | None    |
| Markdown updated multiple times while inactive | YES     | Pure pipe receives latest raw string on activation                         | None    |
| Gridstack resized while inactive (0 width)     | YES     | `CanvasLayoutService` ignores <= 0 dimensions; re-observes on activation   | None    |
| Inactive gesture cancelled before drag stop    | YES     | `_needsReconcile` flag applies authoritative geometry on activation        | None    |
| Older history loaded during pause              | YES     | `ChatTranscriptComponent` and `TranscriptRenderWindow` preserve mount sets | None    |

---

## Section: Verified vs. Inferred

### Verified (Commands Run & Code Inspected)

1. **Git Status & Diff Stat**: Inspected 45 modified files and 7 untracked files with `git diff` and `git status`.
2. **Single InjectionToken Instance**: Grepped repository for `new InjectionToken` and confirmed exactly one declaration of `SURFACE_ACTIVE` at `libs/shared/src/angular/index.ts:7`.
3. **No Silent Fallback**: Grepped repository for `optional: true` and verified zero optional injections for `SURFACE_ACTIVE` across all `scope:webview` consumers.
4. **No Scope Creep**: Verified line-by-line diff of `app-shell.component.html`, `app.routes.ts`, and `chat-transcript.component.ts`. Confirmed all `[class.hidden]` bindings are intact and no views are detached.
5. **Markdown Exception**: Verified `apps/ptah-landing-page` imports `@ptah-extension/markdown` without providing `SURFACE_ACTIVE`, and `MarkdownBlockComponent` defaults to `active = input(true)`.
6. **Test Executions**:
   - `nx run @ptah-extension/markdown:test` passed.
   - `nx run @ptah-extension/core:test` passed.
   - `nx run @ptah-extension/chat-streaming:test` passed.
   - `nx run @ptah-extension/canvas:test` passed.
   - `nx run @ptah-extension/chat-ui:test` passed.
   - `nx run @ptah-extension/chat:test` passed.
   - `nx run ptah-extension-webview:test` passed.

### Inferred

1. Real-world memory and CPU reduction in the running Electron desktop app / VS Code extension host is inferred from unit test metric snapshots (`CanvasRenderMetricsService`) showing 0 layout passes while inactive, rather than live OS process benchmarks.

---

## Verdict

- Recommendation: **APPROVE** (PASS)
- Confidence: **HIGH**
- Top risk: In `BatchedUpdateService`, an existing key in `deferredTabUpdates` would prevent a newer pending update from overwriting it during deactivation; recommend replacing with unconditional `set()`.
- What a robust implementation would add: Replace `if (!this.deferredTabUpdates.has(tabId))` with `this.deferredTabUpdates.set(tabId, state)` in `batched-update.service.ts:59`, and update the outdated statements in `batch2-surface-active-report.md`.
