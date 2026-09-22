# Batch 2 — SURFACE_ACTIVE activity contract

> **The canvas portion described below did NOT ship.** It was reverted out of
> PR 574 before merge: it regressed the `real Gridstack drag keeps an explicit
2+1 row` electron-e2e test on three CI runs across two commits, while the
> canvas unit suite — including the unit-level equivalent of that assertion —
> stayed green. Everything else in this report shipped as written.
>
> Reverted: `canvas-layout.service.ts`, `canvas-workspace-grid.component.ts`
> and both specs, restored to their pre-batch state. Re-filed as
> **TASK_2026_531_c4a8**, which carries the evidence, the ruled-out
> hypotheses and the one ResizeObserver ordering fix that should come back
> with it. The original attempt is recoverable from commit `acb791814`.
>
> Sections 1 and 2 still describe canvas as a gated consumer, and the
> measurement in the CanvasRenderMetricsService section was taken against the
> reverted code. Read those as the proposal, not as shipped behaviour.

## 1. Token design and injector reach

Implemented only the activity batch. The existing Angular Router foundation, component lifetimes and every `[class.hidden]` binding remain. No RouteReuseStrategy, detach, child routes, host persistence or panel serialization was introduced.

The single token is `InjectionToken<Signal<boolean>>('SURFACE_ACTIVE')` defined in `libs/shared/src/angular/index.ts`, an Angular-only secondary entry point exposed via `./angular` in `libs/shared/package.json` with `@angular/core` as an optional peer (`peerDependenciesMeta`), so Node/CLI/server consumers never resolve Angular. `tsconfig.base.json` maps `@ptah-extension/shared/angular` (deliberately omitted from the three app `tsconfig.build.json` files, because those Node runtimes must never resolve Angular). `libs/frontend/core/src/lib/routing/surface-active.ts` is a pure re-export, so exactly one token instance exists. Markdown does not inject the token and does not import core: `SurfaceMarkdownPipe.transform(raw, active)` takes activity as an argument, keeping markdown `scope:shared` and consumable by the landing page. Webview hosts read activity and pass the current boolean to the pure pipe or the MarkdownBlockComponent signal input.

Evidence: markdown/project.json is scope:shared/type:ui, while core is scope:webview/type:core. The actual chat-ui/project.json in this worktree is scope:webview/type:feature, permitting its existing core imports; no tags were changed for this implementation. The new input approach also avoids the four-config path override issue entirely.

`surfaceActiveFor(id)` in surface-active.ts:8 returns a computed signal over SurfaceRouterService.currentSurface(). That service follows settled NavigationEnd events; cancelled navigation does not optimistically change activity. Each addressed route has its own provider in app.routes.ts.

**Chat and canvas are outside the outlet.** Their existing wrappers now carry `ptahSurfaceActive="chat"` and `ptahSurfaceActive="canvas"` at app-shell.component.html:628 and :599. `SurfaceActiveDirective` (core routing, line 16) provides the token from an **element injector**, which descendants inherit, including the canvas instantiated through NgComponentOutlet. Its computed activity is:

| Addressed surface    | Layout mode | Chat tree | Canvas tree |
| -------------------- | ----------- | --------- | ----------- |
| chat                 | single      | true      | false       |
| chat                 | grid        | false     | true        |
| any standalone route | either      | false     | false       |

This is router-derived activity plus the existing layout-mode selector, not a constant true signal. The core `surface-active.spec.ts` navigates to settings and back, switches grid/single, verifies both values, exercises NgComponentOutlet and confirms child DOM identity survives.

The app-level provider uses `surfaceActiveFor('chat')` for the root-scoped BatchedUpdateService, which ingests streaming state for **both** layouts. The element providers narrow the rendered trees; route providers narrow standalone surfaces. This avoids incorrectly trying to inject a child provider into a root-scoped service.

MarkdownBlockComponent defaults its active input to true for website and global-modal embeddings without a webview surface. Hidden chat/canvas descendants receive the real inherited signal value from their webview hosts. Root BatchedUpdateService and the expensive ExecutionNode, transcript and canvas consumers require an explicit token provider; their isolated test fixtures provide activity deliberately.

Stack verified from package.json: Angular 22.1.7, signals/inject, standalone components and OnPush. Existing ngx-markdown + marked + configured DOMPurify remain the rendering/sanitization path. Existing styles and markup are retained.

### Missing-provider behavior and current placement

The final implementation defines `SURFACE_ACTIVE` in `libs/shared/src/angular/index.ts`, an Angular-only secondary entry point exposed via `./angular` in `libs/shared/package.json` with `@angular/core` as an optional peer (`peerDependenciesMeta`), ensuring Node/CLI/server runtimes never resolve Angular. `tsconfig.base.json` maps `@ptah-extension/shared/angular` (deliberately not added to the three app `tsconfig.build.json` files, so Node runtimes never resolve Angular). `libs/frontend/core/src/lib/routing/surface-active.ts` is a pure re-export, ensuring exactly one token instance exists.

Markdown itself performs **no injection**: it is `scope:shared` and consumed by the landing page, so `SurfaceMarkdownPipe.transform(raw, active)` takes activity as an argument, and `MarkdownBlockComponent` uses `active = input(true)` for website/global embeddings. Every `scope:webview` consumer injects the token **non-optionally** (`inject(SURFACE_ACTIVE)`). An optional inject would fall back to "always active", the gate would be dead, and no test would fail. Specs bind it with `provideSurfaceActiveTesting()` from `@ptah-extension/core/testing`.

Current composition supplies the root token at app.config.ts:128 and narrower chat/canvas element providers at app-shell.component.html:628/:599. The core surface-active.spec.ts exercises the directive injector, NgComponentOutlet and router/layout transitions; markdown's reactivation test exercises the explicit input. These tests verify the tested wiring and resume behavior. Non-optional injection in webview consumers (BatchedUpdateService, ExecutionNode, transcript, canvas, thinking-block, message-bubble, etc.) guarantees that any host mounted without an activity provider fails loudly at construction.

## 2. Consumers: pause and lossless reactivation

### Transcript rAF throttle and streaming publication

- `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:390` — the actual streamed-text render throttle. Inactivity cancels its frame, invalidates its generation and retains the newest raw content. Activation schedules one streaming frame, or publishes immediately if the node finalized while hidden. An old callback cannot clear or publish a newer frame.
- `libs/frontend/chat-streaming/src/lib/batched-update.service.ts:42`, `:53`, `:135` — root streaming publication additionally gates on surface activity. Pending state moves to the deferred map, no hidden frame is scheduled, and activation drains eligible tabs using their latest state. Generation checks reject cancelled callbacks. A newer active update replaces an older deferred one.
- Synchronous turn finalization deliberately keeps the established flushSync contract: it must drain/clear completed state so activation cannot resurrect a finished stream. This preserves ingestion correctness while the downstream render gates pause rendering.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:194` combines inherited activity with the existing per-tab active input. The frozen VM, scroll-follow controller, resize observation and replay-retention release use this combined signal. Scroll frame generations prevent stale writes and preserve the saved unpinned offset.

Reactivation tests: execution-node.render-throttle.spec.ts (cancelled frame, newest hidden content and hidden finalization); batched-update.visibility.spec.ts (stale frame plus latest-state drain); chat-transcript.component.spec.ts (catch-up, stale scroll frames and saved scroll restoration).

### Markdown parsing and sanitization

`libs/frontend/markdown/src/lib/surface-markdown.pipe.ts:14` holds the last published string while inactive. The raw input remains in its original component signal/input. Activity is an explicit second argument: the pure pipe reruns on either raw text or activity changes, including activation with unchanged raw text. The host reads the signal in its OnPush template, so activation schedules that view. While paused, ngx-markdown receives the same published string and does not rerun marked/DOMPurify.

The existing MarkdownBlockComponent uses this gate. All direct ngx-markdown data bindings found in the task's chat and chat-ui consumer areas use the same pipe; no alternate sanitizer, parser or raw-HTML binding was introduced. Exact binding locations are listed below.

`surface-markdown.spec.ts` exercises the real MarkdownService and configured DOMPurify: two hidden input updates cause zero parse calls; activation causes one parse of the newest raw string, produces the latest strong text, strips an onerror attribute and does not parse again on an unchanged check. The markdown Jest transform now matches the established chat transform for marked's ESM .js distribution.

### IntersectionObserver windowing

The named windowing consumer is in **chat**, not chat-ui: `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts:93`, `:111`, `:203`. It previously only ignored inactive callbacks. It now disconnects, preserves the pre-pause intersecting/retained/height state, reconnects and seeds visible registered slots from geometry before waiting for fresh observations. Old observer callbacks are rejected by instance identity. No-observer fallback still mounts all messages.

Transcript activity drives this existing service; the older-history sentinel receives the combined activity through chat-transcript.component.html:8. Replay mounts remain monotonic until their deferred release is safe.

Reactivation tests in transcript-render-window.spec.ts cover reconnect/observation registration, stale callback rejection after reconnect, seeding a newly visible slot before any new callback, retained replay mounts and initially inactive attachment. Transcript component tests cover the inherited signal, not only the window service's local flag.

### Gridstack

- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:207` combines the inherited canvas activity (through CanvasLayoutService) with workspace visibility.
- `:297` and the adjacent linked-signal view models retain the last rendered layout/items/compact height without recomputing while inactive; latest tile intent and tab view constraints are read on activation.
- `:415` performs Gridstack work after rendering. The inactive edge resets the activation latch; the next active edge invokes onResize exactly once, then applies current authoritative geometry. Subsequent checks do not repeat the activation remeasure. Lock behavior and cancelled-gesture reconciliation survive the pause.
- `libs/frontend/canvas/src/lib/canvas-layout.service.ts:58`, `:88`, `:174` preserve measured geometry, ignore inactive/zero-size ResizeObserver entries, cancel pending frames and request fresh observation after unhide. A generation guard rejects an old measurement frame even after activation.

The codebase has no literal Gridstack `layout()` call in these consumers: its equivalent work is computeLayout plus authoritative column/cell/widget updates. The existing visibility guard was only workspace-local and did not cover a hidden top-level surface; it has been extended in place.

Reactivation tests in canvas-workspace-grid.component.spec.ts prove exactly one onResize, latest hidden compact view/width intent catch-up, workspace-visibility gating and locked cancelled-gesture settlement. CanvasLayoutService tests cover hidden/zero-size measurements and stale measurement callbacks after activation.

### CanvasRenderMetricsService

`libs/frontend/canvas/src/lib/canvas-render-metrics.service.ts` already owns bounded counters and `OrchestraCanvasComponent` already provides it. It was reused without duplicating or replacing instrumentation. The measurement below is emitted by canvas-workspace-grid.component.spec.ts:1308 and reads the actual service snapshots around the component workload.

## 3. Measured before/after figures

Controlled Angular/Jest fixture, three canvas tiles, eight alternating compact/full tab-view changes. The active control represents work that would continue without top-level activity gating; the inactive treatment executes the same workload plus a final hidden compact/width change. These are **real counter readings from CanvasRenderMetricsService**, with Gridstack/DOM geometry supplied by the existing test doubles.

| Counter            | Before: activity enabled control | After: inactive treatment |
| ------------------ | -------------------------------: | ------------------------: |
| layoutComputations |                                8 |                         0 |
| applyChecks        |                                8 |                         0 |
| applyPasses        |                                8 |                         0 |
| gridUpdates        |                               24 |                         0 |

Reactivation then called onResize exactly once, projected all three latest compact heights to 2, and preserved the latest full-width tile intent. The focused measurement run passed 1 test; 42 other tests were intentionally filtered out. Full canvas verification is separate.

This is a controlled operation-count comparison, **not** a browser timing benchmark or a checkout-to-checkout FPS/CPU measurement. No wall-clock performance improvement, desktop long-task reduction or percentage of total application cost is claimed.

## 4. Verification, commands and real output

**Post-reinstall verification: seven-project test, lint and typecheck passed. Standalone webview passed 196 tests. All run-many headers explicitly selected 7 projects. Existing warnings are retained below.**

Final outcomes are recorded in the command transcripts below. The required run-many headers explicitly select **7 projects**. Cache was bypassed and the daemon disabled. Following a real Nx plugin-worker startup failure, later runs also set NX_ISOLATE_PLUGINS=false (supported by the installed Nx isolation/enabled.js); no reset was used.

Initial failures are retained in the evidence: markdown ESM transformation, route fallback edit/shape expectations, markdown peer dependency metadata, a transient canvas syntax error, an unresolved delegated core/routing import, and two isolated transcript fixtures missing their provider. These were fixed before the final verification. The revision logs after the confirmed dependency reinstall supersede all earlier verification. The first revision test run also exposed isolated fixtures without the now-required token provider; its failure output is retained.

PowerShell may label native stderr warnings as NativeCommandError records; the recorded process exit code and Nx/Jest result determine success. Existing lint and Angular optional-chain warnings remain visible. No git command was run.

### Changed source and verification files

- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\core\src\lib\routing\surface-active.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\core\src\lib\routing\surface-active.directive.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\core\src\lib\routing\surface-active.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\core\src\lib\routing\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\apps\ptah-extension-webview\src\app\app.routes.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\apps\ptah-extension-webview\src\app\app.config.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\apps\ptah-extension-webview\src\app\webview-routing.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\templates\app-shell.component.html`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat-streaming\src\lib\batched-update.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat-streaming\src\lib\batched-update.visibility.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\organisms\execution\execution-node.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\organisms\execution\execution-node.render-throttle.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\markdown\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\markdown\src\lib\surface-markdown.pipe.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\markdown\src\lib\surface-markdown.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\markdown\src\lib\markdown-block.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\markdown\jest.config.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\markdown\package.json`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat-ui\src\lib\molecules\agent-summary.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat-ui\src\lib\molecules\thinking-block.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat-ui\src\lib\molecules\agent-card\agent-card-output.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat-ui\src\lib\molecules\tool-execution\code-output.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat-ui\src\lib\molecules\tool-execution\diff-display.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-input-display.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\templates\chat-view.memo.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\templates\chat-view.keepalive.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\canvas\src\lib\canvas-layout.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\canvas\src\lib\canvas-layout.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-render-window.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-render-window.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat\src\lib\components\organisms\transcript\testing\transcript-spec-harness.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat-ui\src\lib\molecules\subagent-transcript-viewer.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-524-batch2-surface-active\libs\frontend\chat-ui\src\lib\molecules\notifications\compaction-marker.component.ts`

The parent session also supplied explicit test activity providers through the existing core/testing entry point and updated isolated fixtures; those edits are included in the final verification. No new entry point was needed.

### Exact markdown host bindings

- `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:139` — `[data]="renderedContent() | surfaceMarkdown: surfaceActive()"`
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:113` — `message().rawContent || '' | surfaceMarkdown: surfaceActive()`
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:251` — `[data]="userDisplayContent() | surfaceMarkdown: surfaceActive()"`
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:257` — `[data]="userDisplayContent() | surfaceMarkdown: surfaceActive()"`
- `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:161` — `segment.content | surfaceMarkdown: surfaceActive()`
- `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:285` — `[data]="segment.content | surfaceMarkdown: surfaceActive()"`
- `libs/frontend/chat-ui/src/lib/molecules/agent-summary.component.ts:79` — `[data]="block.content | surfaceMarkdown: surfaceActive()"`
- `libs/frontend/chat-ui/src/lib/molecules/agent-summary.component.ts:108` — `[data]="block.content | surfaceMarkdown: surfaceActive()"`
- `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts:72` — `[active]="surfaceActive()"`
- `libs/frontend/chat-ui/src/lib/molecules/subagent-transcript-viewer.component.ts:171` — `[active]="surfaceActive()"`
- `libs/frontend/chat-ui/src/lib/molecules/thinking-block.component.ts:79` — `[data]="node().content || '' | surfaceMarkdown: surfaceActive()"`
- `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts:47` — `[data]="formattedOutput() | surfaceMarkdown: surfaceActive()"`
- `libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts:62` — `[data]="formattedDiff() | surfaceMarkdown: surfaceActive()"`
- `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts:80` — `| surfaceMarkdown: surfaceActive()`
- `libs/frontend/markdown/src/lib/markdown-block.component.ts:29` — `[data]="content() | surfaceMarkdown: active()"`

### Dependency repair before revision tests

```powershell
npm ci --ignore-scripts --no-audit --no-fund *> .nx/surface-active-revision-install.log
$taskExit = $LASTEXITCODE
Get-Content .nx/surface-active-revision-install.log -Tail 25
Write-Output ('ngx-markdown directory exists: ' + (Test-Path node_modules/ngx-markdown))
Write-Output ('Angular core directory exists: ' + (Test-Path node_modules/@angular/core))
exit $taskExit
```

Observed exit code: 0. Directory checks: ngx-markdown=True; Angular core=True. Full installer output:

```text
node.exe : npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check

out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more

comprehensive and powerful.

At line:1 char:1

+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...

+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

    + CategoryInfo          : NotSpecified: (npm warn deprec...e and powerful.:String) [], RemoteException

    + FullyQualifiedErrorId : NativeCommandError



npm warn deprecated rimraf@2.6.3: Rimraf versions prior to v4 are no longer supported

npm warn deprecated glob@7.2.3: Old versions of glob are not supported, and contain widely publicized security

vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be

purchased (at exorbitant rates) by contacting i@izs.me

npm warn deprecated glob@7.2.3: Old versions of glob are not supported, and contain widely publicized security

vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be

purchased (at exorbitant rates) by contacting i@izs.me

npm warn deprecated whatwg-encoding@3.1.1: Use @exodus/bytes instead for a more spec-conformant and faster

implementation

npm warn deprecated whatwg-encoding@2.0.0: Use @exodus/bytes instead for a more spec-conformant and faster

implementation

npm warn deprecated @angular/platform-browser-dynamic@22.1.7: @angular/platform-browser-dynamic is deprecated. Use

`@angular/platform-browser` instead.

npm warn deprecated boolean@3.2.0: Package no longer supported. Contact Support at https://www.npmjs.com/support for

more info.

npm warn deprecated source-map@0.8.0-beta.0: The work that was done in this beta branch won't be included in future

versions

npm warn deprecated glob@10.5.0: Old versions of glob are not supported, and contain widely publicized security

vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be

purchased (at exorbitant rates) by contacting i@izs.me

npm warn deprecated lucide-angular@1.0.0: Package deprecated. Please use @lucide/angular instead.



added 2351 packages in 3m


```

---

## 4b. Verification output — trimmed

The lane's original report embedded roughly 43,000 lines of raw command
output, superseded historical attempts and captured shell history, at 1.7 MB.
That is thirty times the largest other document in this folder
(`implementation-note.md`, 59 KB) and it is log noise rather than reasoning,
so it was removed before committing. The commands themselves are listed above
in section 4; the results below are the ones the orchestrating session re-ran
independently rather than taking from the lane.

Re-run by the orchestrator against the final tree, with
`env -u NODE_PATH -u NX_ISOLATE_PLUGINS NX_DAEMON=false`:

| Target | Projects                                                                      | Result               |
| ------ | ----------------------------------------------------------------------------- | -------------------- |
| `test` | chat, chat-ui, chat-streaming, canvas, markdown, core, ptah-extension-webview | 7 projects, all pass |
| `lint` | the same seven plus `shared`                                                  | 8 projects, all pass |

`shared` is in the lint set deliberately. Its `eslint.config.mjs` enables
`@nx/dependency-checks` at `error` severity, so it is the project that catches
an undeclared `@angular/core` import in the `./angular` entry point. An earlier
verification list omitted it and would have gone green locally while failing in
continuous integration.

One environment note for whoever runs these next: setting `NX_ISOLATE_PLUGINS`
to any value breaks Angular test resolution in this repository and produces
spurious `NG0203` "injection context" failures across `markdown` and `core`
that have nothing to do with the code. Leave it unset.

## 5. Anything I could not do

- No live VS Code/Electron browser profiling, FPS measurement or screenshot-based visual review was performed. The measured win is the explicitly bounded Angular fixture counter comparison above.
- The initial dependency directory was incomplete despite the supplied environment description. The revision reran npm ci --ignore-scripts --no-audit --no-fund, installed 2,351 packages and confirmed node_modules/ngx-markdown exists before tests. The earlier verification used an install with scripts disabled. The follow-up plain npm ci subsequently completed lifecycle scripts and verified SQLite under Electron; see its output above.
- Some early exploratory read/search output was truncated by the tool before command-history capture began. It cannot honestly be reproduced as original stdout. Later captured command output and all final verification log files are included below/in section 4 in full; early truncation is a reporting limitation.
- The scoped diagnostic tool reported errors in untouched spec/mock typing; the repository's declared production typecheck targets are separately recorded. No unrelated spec/mock cleanup was attempted.
- Batch 3 detach/reuse and batch 4 persistence/child routing remain out of scope as requested.

- Some exploratory commands in the revision also printed only tails or truncated search output. Their full original output was not retained. All required verification commands and their full redirected output are preserved above; no missing exploratory stdout has been invented.

- Optional activity fallback in presentational webview markdown hosts has no missing-provider runtime alarm; the exact scope of this limitation is documented in section 1.
