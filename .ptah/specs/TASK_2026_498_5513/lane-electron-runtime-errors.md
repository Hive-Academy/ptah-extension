# Electron runtime error diagnosis

## 1. Backlog cleanup store is undefined

**Symptom** — `[WARN] [skill-synthesis] backlog cleanup failed: {"error":"Cannot read properties of undefined (reading 'readState')"}`

**Root cause** — `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts:85` declares `store: SkillBacklogCleanupStore` as an undecorated constructor parameter. The Electron main bundle does not contain `design:paramtypes` metadata for this class; it contains explicit tsyringe parameter decorators only for constructor positions 0 (`LOGGER`) and 7 (`WORKSPACE_PROVIDER`). That leaves positions 1 through 6 as holes in tsyringe's parameter array. The container therefore calls the constructor with `undefined` for `store`, `verdicts`, `queue`, `extractor`, `transcriptLocator`, and `foreground`. Resolution succeeds because the constructor has no runtime guard. The first dereference is `this.store.readState()` at `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts:108`, so `this.store`, not a value returned by `readState`, is the undefined object.

The registration at `libs/backend/skill-synthesis/src/lib/di/register.ts:70` uses `registerSingleton(SkillBacklogCleanupService)`, while the public token aliases that class at `libs/backend/skill-synthesis/src/lib/di/register.ts:111`. Neither registration supplies constructor dependencies explicitly. The built evidence is decisive: `dist/apps/ptah-electron/main.mjs:125120` assigns the second constructor argument to `this.store`, and its decorator block at `dist/apps/ptah-electron/main.mjs:125580` has decorators only for arguments 0 and 7.

This is not the Zod 4.6.5 absent-key change. No Zod schema is evaluated on this path before the failure. A scan of `skill-synthesis`, `thoth-runtime`, and `cron-scheduler` found no transformed optional field analogous to the two fixed curator schemas; execution fails at the DI-created service's first store call.

**Call path** — `startThothCron` registers `@ptah/skills-backlog-cleanup` as `handler:skills:backlog-cleanup` at `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:318`. A scheduled or catch-up slot reaches `JobRunner.run` and `dispatch` at `libs/backend/cron-scheduler/src/lib/job-runner.ts:176` and `:255`. The registered wrapper calls the cleanup handler at `libs/backend/thoth-runtime/src/lib/activity-emitter.ts:120`. `createSkillBacklogCleanupHandler` lazily resolves the service through `SKILL_BACKLOG_CLEANUP_SERVICE` at `libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.ts:39`, then calls `service.run` at `:59`. Because `WORKSPACE_PROVIDER` was explicitly injected, `readConfig()` succeeds. `run()` then reaches `this.store.readState()` at `skill-backlog-cleanup.service.ts:108` and throws before boot deferral, battery, foreground, or abort checks.

**Attribution** — **pre-existing**. `git diff origin/main --` shows no difference for the service, registration, handler, or Electron app tsconfig. `git blame` assigns the undecorated store parameter and failing call to `e420f1b5d8` (2026-09-16), which is already an ancestor of `origin/main`. That commit's parent used Nx 22.6.5, esbuild 0.25, TypeScript 5.9.3, and Zod 4.3.6. Its Electron `tsconfig.app.json` was already identical in the relevant respect: it enabled decorators but did not enable emitted decorator metadata. The migration changed package versions, but it did not introduce this constructor shape or build setting. The source defect was present when backlog cleanup shipped; the migration build merely exposed it in a real cron run.

**Proposed fix** — Add explicit `@inject(...)` decorators for every constructor dependency in `SkillBacklogCleanupService`, preferably using the library's existing `SKILL_SYNTHESIS_TOKENS` for cross-service seams and class tokens only where that is the established local convention. Add an Electron composition-root test that resolves the public cleanup-service token and asserts all collaborators are real instances before calling `run()`. A broader alternative is to restore reliable decorator-metadata emission in the Electron esbuild pipeline, but that has a much larger blast radius. The cost of getting the narrow fix wrong is silent token mismatch: tsyringe can again construct a superficially valid singleton with missing or different collaborators, delaying failure until an hourly job mutates cleanup state.

**Confidence** — **high**. The exception text, source dereference, emitted constructor, emitted decorator indices, and DI registration all agree. Confidence would only be raised further by a regression test against the Electron composition root; no rebuild was performed because this investigation explicitly forbids it.

## 2. Cron reports only `unexpected-error`

**Symptom** — `[ERROR] [cron-scheduler] run failed Error: unexpected-error`

**Root cause** — `unexpected-error` is produced at `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts:161`. The catch block still retains the real message in `report.error` at `:164`, but `createSkillBacklogCleanupHandler` discards that field and throws only `new Error(report.reason ?? 'unknown')` at `libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.ts:67`. `JobRunner` then records and logs only `error.message` at `libs/backend/cron-scheduler/src/lib/job-runner.ts:221` and `:225`. What it hides in this run is the finding-1 TypeError: `this.store` is undefined when `run()` calls `readState()`.

The two adjacent log records are one execution, not independent failures. In `C:\Users\abdal\AppData\Roaming\Ptah Dev\logs\Ptah Electron-2026-09-21.log`, the cleanup warning at line 819 is immediately followed by the cron failure at lines 820-825 with the same millisecond timestamp. The bundle frames also match this chain: `main.mjs:195267` is the handler's replacement throw, and `main.mjs:195313` is `withActivityEmit` awaiting that handler.

**Call path** — The call path is the same through `JobRunner.dispatch`, `withActivityEmit`, and `createSkillBacklogCleanupHandler`. `SkillBacklogCleanupService.run()` catches the TypeError at `skill-backlog-cleanup.service.ts:152`, logs its real message at `:156`, and returns `{status: 'failed', reason: 'unexpected-error', error: message}`. The handler sees `failed` at `skill-backlog-cleanup-job.ts:66`, throws a new generic error at `:67`, and loses the original error and stack. `withActivityEmit` rethrows by design. `JobRunner.run()` catches the replacement error at `job-runner.ts:212` and writes/logs `unexpected-error`.

**Attribution** — **pre-existing**. The flattening source is unchanged from `origin/main`. `git blame` assigns the service catch and generic reason to `e420f1b5d8` and the handler replacement throw to `625b3861cb`, both 2026-09-16 commits already contained by `origin/main`, before the dependency-migration commits. The hidden underlying DI defect is likewise pre-existing, as finding 1 establishes.

**Proposed fix** — Fix the DI defect first. Separately, preserve diagnostics across the handler boundary: throw a typed cleanup-job error whose stable public message/reason remains `unexpected-error` but whose `cause` is built from `report.error`, and make the structured logger include that cause. Keep the persisted run-row reason sanitized. Simply throwing `report.error` would improve this log but risks persisting provider, filesystem, database, or user-derived details in cron history and UI; that disclosure is the main cost of getting the observability fix wrong.

**Confidence** — **high**. Both source transformations are explicit, both bundle frames map to them, and the real and flattened records are adjacent in the runtime log.

## 3. One chat transcript is fully recreated

**Symptom** — `[WARN] [renderer] console.warning: {"windowId":1,"message":"NG0956: The configured tracking expression (track by identity) caused re-creation of the entire collection of size 1. This is an expensive operation requiring destruction and subsequent creation of DOM nodes, directives, components etc. Please review the \"track expression\" and make sure that it uniquely identifies items in a collection.","source":"file:///D:/projects/ptah-extension/dist/apps/ptah-electron/renderer/chunk-XVCNSYIW.js:19251"}`

**Root cause** — The matching expensive identity-tracked block is `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:64`:

```html
@for (tabId of transcriptTabIds(); track tabId) {
<ptah-chat-transcript ... />
}
```

Angular compiles the exact `track tabId` expression to `ɵɵrepeaterTrackByIdentity`; the built call is `ChatViewComponent_Conditional_3_For_7_Template` in `dist/apps/ptah-electron/renderer/chunk-7643C6E5.js:34516`. Its repeated view contains `ChatTranscriptComponent`, so Angular classifies recreation as expensive. `transcriptTabIds` explicitly returns a one-element array in tile/session-context mode at `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:630-632`, and can also replace the main panel's retained singleton when the old tab becomes unresolvable while a different tab becomes active (`:638-643` plus `libs/frontend/chat/src/lib/services/transcript-retention.service.ts:146`). When the sole tab ID changes, identity tracking correctly regards the new string as a different item, destroys the old transcript subtree, creates the new one, and meets NG0956's “all one items recreated” condition.

Runtime ordering supports this mapping. Eight milliseconds after the warning, the log records `session:status`; a newly mounted chat surface triggers that recovery call when its MCP status has no record (`libs/frontend/chat/src/lib/components/molecules/mcp-status-chip.component.ts:311-315` and `:424`). No other identity-tracked one-item block in the active shell both owns an expensive transcript subtree and explains that immediate session-status recovery.

This is a performance warning, not a functional fault. The current tracking key is unique. The warning arises because a one-item collection was semantically replaced, not because two simultaneous rows collided on a key.

**Call path** — A tab/session-context change recomputes `ChatViewComponent.transcriptTabIds` at `chat-view.component.ts:628`. Angular updates the `@for` block at `chat-view.component.html:64`; the old singleton ID and new singleton ID have different identity keys. Angular's repeater reconciler destroys `ptah-chat-transcript`, creates its replacement, observes one destroy plus one create for a collection of length one, and emits NG0956 from the shared runtime at `chunk-XVCNSYIW.js:19251`. The new chat surface then performs its session-status recovery call.

**Attribution** — **pre-existing**. `git diff origin/main --` shows no change to the template or `transcriptTabIds` computation. `git blame` assigns both to `c54c4885bc` (2026-07-10), well before this migration. The same NG0956 condition and message exist in the installed Angular 21.2.6 package as in Angular 22.1.7, so Angular 22 did not add this diagnostic condition. The migration did not introduce the identity tracker or its one-item source; the current dev run merely surfaced the existing replacement cost.

**Proposed fix** — Do not change the main retained-transcript loop to `track $index`; that would bind component state to positions and can show stale session state after removal or eviction. If profiling shows the one-item recreation matters, split tile mode from retained-main-panel mode: use a single non-loop transcript component for tile mode, update its `tabId`, and explicitly reset every session-scoped child state on ID change; keep `track tabId` for the main retention list. The cost of getting this wrong is worse than the warning: state, scroll position, streamed nodes, permissions, or MCP status can leak from one session into another. If full teardown is required for isolation, retain current code and accept the diagnostic.

**Confidence** — **medium**. Compiled identity tracking, collection shape, expensive child component, and the immediate session-status recovery all point to this block. The Electron console bridge logs Angular's shared runtime location but drops the caller stack, so it cannot provide direct component-frame proof. Capturing a DevTools stack or adding a targeted test that swaps the one-element session context while spying on `console.warn` would raise confidence to high.

## Shared cause

Findings 1 and 2 have the same origin. Finding 1 is the underlying TypeError caused by an incompletely injected `SkillBacklogCleanupService`. Finding 2 is that same TypeError after `run()` converts it to a failed report with reason `unexpected-error`, and the cron handler throws a new error containing only that reason. The identical execution path, adjacent same-timestamp log entries, and bundle frames prove the relationship. Finding 3 is unrelated renderer reconciliation behavior.
