# Batch 10 — Track C frontend remedies — report

**Task**: TASK_2026_383
**Branch**: `task/383-degradation-audit`
**Worktree**: `D:/projects/ptah-extension/.claude-worktrees/task-383`
**Executor**: `frontend-developer`
**Date**: 2026-09-07

**Outcome**: 10.1 DONE. 10.2 **STOPPED — not implemented, reported** (PC-2's
premise fails; see below). 10.3 DONE in part (loader single-flight landed; the
dashboard rewire is rejected with evidence).

---

## Task 10.1 — delete the eager agent preload — DONE

### What changed

`libs/frontend/chat-ui/src/lib/molecules/chat-input/agent-selector.component.ts`

- Deleted `ngOnInit()` (was `:158-160`) and the `preloadAgents()` method it was
  the only caller of (was `:165-175`). Deleted, not flagged off, per the batch.
- Dropped `implements OnInit` from the class declaration (was `:144`) and the
  now-unused `OnInit` import from `@angular/core` (was `:22`).
- Replaced the deleted block with a doc comment on `toggleDropdown()` recording
  why the preload is absent and what it cost, so it is not re-added.

`toggleDropdown()` is untouched and still loads on first open when
`this._agents().length === 0`, which is the lazy path the batch relies on.
`AgentDiscoveryFacade.fetchAgents()` keeps its own `_isCached` / `_isLoading`
guards (`agent-discovery.facade.ts:32,49`), so the second open costs nothing.

### Verification of the "no remaining caller" condition

`grep -rn "preloadAgents"` over `libs` and `apps` returned only the two lines
inside this file (the `ngOnInit` call site and the declaration). The method had
no external caller, so it was deleted rather than kept.

### New spec

CREATED
`libs/frontend/chat-ui/src/lib/molecules/chat-input/agent-selector.component.spec.ts`
— there was no spec for this component before. Three cases:

1. no `fetchAgents` call on mount, and `agents()` is empty;
2. the first `toggleDropdown()` fetches once and populates;
3. a second open after a close does not re-fetch.

Case 1 is the regression pin for this task; cases 2 and 3 pin the behaviour the
deletion depends on.

---

## Task 10.2 — drop the constructor model fetch — STOPPED, NOT IMPLEMENTED

**No edit was made to `model-state.service.ts`.** The literal PC-2 check passes,
but the premise it exists to protect does not, and the batch text says the task
"changes shape" in exactly that case. Reporting instead of improvising, and
specifically not expanding it into the model-loading redesign the batch forbids.

### PC-1 — confirmed as written

`libs/frontend/core/src/lib/services/model-state.service.ts:150-153`:

```ts
constructor() {
  this.loadModels();          // :151
  void this.hydratePricing(); // :152 — out of scope, stays
}
```

`:151` is `this.loadModels()`, not `refreshModels()`. PC-1 is accurate.

### PC-2 — the binding resolves, cited

The chain the batch asked me to confirm:

1. `libs/frontend/chat-state/src/lib/tab-manager.service.ts:782` —
   `this.modelRefresh.refreshModels().catch(...)`, inside `createTab()`
   (declared `:761`).
2. `this.modelRefresh` is `inject(MODEL_REFRESH_CONTROL)` at
   `tab-manager.service.ts:133`; the token is declared at
   `libs/frontend/chat-state/src/lib/model-refresh-control.ts:36`.
3. The token's only production binding is
   `libs/frontend/chat/src/lib/services/chat-store/model-refresh-control.provider.ts:24-33`:
   `useFactory: (modelState: ModelStateService) => ({ refreshModels: () => modelState.refreshModels() }), deps: [ModelStateService]`.
4. That provider is registered once, at the composition root:
   `apps/ptah-extension-webview/src/app/app.config.ts:183`
   (`...provideModelRefreshControl()`, imported at `:37`). No other production
   binding of `MODEL_REFRESH_CONTROL` exists; every other hit is a spec mock.
5. `ModelStateService.refreshModels` is at `model-state.service.ts:246` and its
   first statement is `await this.loadModels()` (`:247`), reaching `loadModels`
   at `:264`.

So `TabManagerService:782` does resolve to `ModelStateService.refreshModels` →
`loadModels`. **PC-2's binding check passes.**

### Why I stopped anyway — `createTab` is not on the boot path

PC-2's wording is "before relying on `createTab` as the boot-path cover". The
binding resolves, but `createTab` is never called during boot, so it is not a
cover. Evidence, all from `grep -rn "\.createTab(" --include=*.ts libs apps`
with specs excluded — every production caller is user-initiated:

| Call site                                                                         | Trigger                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:510`      | `handleCreateSession()` — the new-session popover's confirm button |
| `libs/frontend/chat/src/lib/services/keyboard-shortcuts.service.ts:67`            | new-tab keyboard shortcut                                          |
| `libs/frontend/chat/src/lib/services/message-sender.service.ts:349`               | user sends a message with no active tab                            |
| `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:59` | user launches a task prompt                                        |
| `libs/frontend/canvas/src/lib/canvas.store.ts:154`                                | user adds a canvas tile                                            |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts:170`       | user starts a tribunal run                                         |

There is no automatic first-tab creation: `grep -n "createTab"` over
`tab-manager.service.ts` and `tab-workspace-partition.service.ts` returns only
the declaration at `:761` and its own log string at `:784` — nothing calls it
internally, and no `tabs().length === 0` bootstrap exists anywhere in
`libs/frontend/chat`, `libs/frontend/chat-state` or
`apps/ptah-extension-webview`.

The other five `refreshModels()` callers are user-initiated too:

- `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:265` —
  inside `refreshWorkspaceProviderState`, reached only from
  `switchWorkspace(newPath)` (`:121`, `:203`);
- `libs/frontend/core/src/lib/services/auth-state.service.ts:726` (post-save of
  credentials) and `:1097` (post-login);
- `libs/frontend/chat/src/lib/settings/auth/provider-model-selector.component.ts:495,514,573`
  — the settings screen's own refresh button and provider switches.

### The consequence, and why it is a functional regression not a perf win

`ModelStateService`'s constructor is therefore the **only** thing that ever
populates `availableModels()` on a cold boot. The chat model dropdown,
`libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.ts`,
reads `modelState.availableModels()` (`:197`, `:207`, `:217`) and
`modelState.isLoaded()` (`:106`) and has **no lazy-load path of its own** — no
`ngOnInit`, no `ensureLoaded()`, no `refreshModels()` call anywhere in the file.

Deleting `:151` would leave a user who boots into restored tabs looking at the
`isLoaded() && length === 0` empty state in the model selector until they
happened to create a tab, switch workspace, or open settings. That trades a
167–905 ms redundant RPC — the batch's own stated prize — for a broken control
on the main chat surface. Not a trade I will make silently.

### What the second measured `config:models-list` most likely is

The measurement records two calls per boot. Given the caller inventory above,
the second is not `createTab`. The candidates are the boot-window
`auth-state.service.ts` post-login path and the settings surface, both of which
are conditional on what the user does. I did not instrument a boot to pin it —
that is measurement work, outside this batch's file ownership.

### Recommendation (not implemented)

The redundant RPC is real and the in-flight coalescing at `:264-282` already
makes the pair one request when they overlap. The correct fix is to give
`ModelStateService` an idempotent `ensureLoaded()` — the exact shape
`PluginCatalogService.ensureLoaded()` and `AuthStateService.loadAuthStatus()`
(`auth-state.service.ts:575-591`) already use in this repo — and have
`ModelSelectorComponent` call it on mount, then delete `:151`. That moves the
fetch from "boot" to "first render of the control that needs it" without losing
it. It is a small change but it is a model-loading design change across two
libs, which this batch explicitly forbids me from making. It wants its own task.

---

## Task 10.3 — one `session:list` loader — DONE IN PART

### What changed (the single-flight — implemented)

`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`

- Added `private loadSessionsInFlight: Promise<void> | null = null` immediately
  after the existing debounce fields (now `:105-123`), with a comment naming the
  five callers and why the 300 ms debounce does not cover them.
- `loadSessions()` (now `:191`) now awaits a new private `runLoadSessions()`
  instead of `_loadSessionsImmediate()` directly. The 300 ms trailing debounce
  is unchanged.
- Added `runLoadSessions()` (now `:213-226`) — the `_loadPromise` single-flight
  shape the batch pointed at in `auth-state.service.ts:575-591`: a caller whose
  timer fires while a read is in flight joins it; the promise clears itself in
  `finally` guarded by identity, so the next caller after it settles gets a
  fresh read.

`_loadSessionsImmediate()` itself is untouched, including its post-RPC
workspace-staleness guard.

Why the debounce alone was not enough: it only coalesces callers arriving before
the timer fires. `loadSessions()` has five independent production callers —
`chat-lifecycle.service.ts:55`, `:248`, `:319`,
`session-stats-aggregator.service.ts:157` and
`chat-message-handler.service.ts:415` — driven by different broadcasts, so one
landing >300 ms after another but inside the ~200 ms RPC window issued a second
identical read. That is the duplicate the batch measured.

### New specs

`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
— added a `loadSessions single-flight (TASK_2026_383 Batch 10.3)` describe with
two cases:

1. a caller whose debounce fires mid-flight shares the one `session:list`;
2. a caller arriving after the previous read settled gets a fresh read (the
   single-flight must not become a cache).

The pre-existing `it.skip('coalesces rapid calls into a single RPC')` at `:833`
was left skipped and untouched — it hangs because `loadSessions()` clears the
prior timer without settling that caller's promise, a pre-existing defect in the
debounce that is outside this batch's scope. Flagged below, not fixed.

### What I did NOT do — the dashboard rewire, and why

The batch says "have the dashboard's analytics state consume the loader instead
of issuing its own RPC". I did not, and
`libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts` is
**unmodified**. Two blocking reasons:

1. **They are different queries, not a duplicate.** The dashboard calls
   (`session-analytics-state.service.ts:225-230`):
   `{ workspacePath, limit: METADATA_LOAD_LIMIT, offset: 0, since: this.rangeSinceMs(this._dateRange()) }`.
   The loader calls (`session-loader.service.ts:218-222`, line numbers
   post-edit): `{ workspacePath, limit: max(SESSIONS_PAGE_SIZE=30, currentOffset), offset: 0 }`
   — **no `since`**, and a page size driven by the sidebar's pagination.
   Serving the dashboard from the loader's signals would silently drop the date
   range the whole analytics surface is built on, and cap it at the sidebar's
   30-row page. That is a behaviour change, not call-count hygiene.
2. **It would cross a library boundary.**
   `libs/frontend/dashboard` does not import `@ptah-extension/chat` today
   (`grep -rn "@ptah-extension/chat'" libs/frontend/dashboard/src` → no hits).
   `SessionLoaderService` lives in `chat` (`type:feature`). Making the dashboard
   depend on the chat feature lib to reuse one RPC is the wrong direction for a
   ~200 ms prize, and would need a token inversion to do properly — again a
   design change this batch forbids.

The honest remaining shape, if anyone wants it: `session:list` with a `since`
bound belongs behind a shared, workspace-scoped session-metadata cache in a
`type:data-access` lib both surfaces may depend on. That is a separate task.

---

## Verification

All commands run from `D:/projects/ptah-extension/.claude-worktrees/task-383`.

### Tests — the required 5-project run

```
npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/dashboard
```

Header read back: **`Running target test for 5 projects`** — N is 5, matching the
5 names asked for, so nothing was silently dropped.

| Project                      | Suites    | Tests                             |
| ---------------------------- | --------- | --------------------------------- |
| `@ptah-extension/core`       | 28 passed | 656 passed                        |
| `@ptah-extension/chat-state` | 15 passed | 338 passed                        |
| `@ptah-extension/dashboard`  | 4 passed  | 43 passed                         |
| `@ptah-extension/chat-ui`    | 23 passed | 122 passed                        |
| `@ptah-extension/chat`       | 62 passed | 946 passed, 2 skipped (948 total) |

`NX Successfully ran target test for 5 projects`.

Counts moved as expected against the pre-edit baseline run: `chat-ui` 22→23
suites and 119→122 tests (the new `agent-selector.component.spec.ts`), `chat`
946→948 tests (the two new single-flight cases). The other three are unchanged,
which is the expected result for `core` (no edit made) and `dashboard` (no edit
made).

### Lint

```
npx nx run-many -t lint -p @ptah-extension/chat-ui @ptah-extension/core @ptah-extension/chat @ptah-extension/dashboard
```

`Running target lint for 4 projects` → `NX Successfully ran target lint for 4
projects`. **17 problems, 0 errors, 17 warnings**, all pre-existing and none in
a line I wrote: `max-lines` on `agent-orchestration-config.component.ts` (988)
and `ptah-cli-config.component.ts` (1034), non-null assertions in an existing
spec, and `Unexpected empty async method 'createNewSession'` at
`session-loader.service.ts:916` — a pre-existing empty method, at a line whose
number shifted by my insertion but whose content I did not touch.

### Acceptance criteria from the batch

| Criterion                                   | Status                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no `autocomplete:agents` in the boot window | Met — the only remaining `fetchAgents()` call site in the component is inside `toggleDropdown()`, pinned by the new spec                                                     |
| no constructor-fired `config:models-list`   | **NOT met** — 10.2 deliberately not implemented, see above                                                                                                                   |
| exactly one `session:list`                  | Improved, not proven — the loader's own callers now coalesce, but the dashboard still issues its own (different) query, so a boot that renders the dashboard still shows two |
| dropdown still populates on open            | Met — pinned by `agent-selector.component.spec.ts` cases 2 and 3                                                                                                             |
| `hydratePricing` still fires                | Met trivially — `model-state.service.ts:152` untouched, and the whole file is unmodified                                                                                     |

No runtime boot-window RPC trace was captured — that is measurement work and
would need a built, running host, which is outside this batch's file ownership.
The criteria above are argued from source and unit tests, not from a fresh
capture.

---

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-383/libs/frontend/chat-ui/src/lib/molecules/chat-input/agent-selector.component.ts`
  — deleted the `ngOnInit` agent preload, `preloadAgents()`, and the `OnInit` implementation and import.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/task-383/libs/frontend/chat-ui/src/lib/molecules/chat-input/agent-selector.component.spec.ts`
  — pins no-fetch-on-mount plus the lazy first-open path.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-383/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
  — added `loadSessionsInFlight` and `runLoadSessions()`; `loadSessions()` now routes through the single-flight.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-383/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
  — two single-flight cases.
- UNCHANGED `libs/frontend/core/src/lib/services/model-state.service.ts` — Task 10.2 stopped.
- UNCHANGED `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts` — rewire rejected.

Nothing outside the four files this batch owns was touched. No commit, no stage,
no branch operation — the working tree is left dirty for the orchestrator.

---

## Deliberately not done

- **Task 10.2 in full.** Stopped at the PC-2 gate as instructed. Needs a
  decision on `ensureLoaded()` before the constructor call can go.
- **380 follow-up item 8** (`SessionLoaderService` resume failure is log-only,
  around `:837-843`) — R-11 marks it out of scope. Read past it, left alone.
- **`model-state.service.ts:152` `void this.hydratePricing()`** — PC-1 puts it
  out of scope.
- **The skipped debounce spec** at `session-loader.service.spec.ts:833` and the
  underlying never-settling-promise defect in `loadSessions()`'s
  `clearTimeout` path. Pre-existing, unrelated to this batch's remit.
- **No boot trace captured.** Acceptance is argued from source and unit tests.

## Out-of-scope observations

1. **`loadSessions()` leaks unsettled promises.** Each call returns a new
   `Promise` whose `resolve`/`reject` live in a `setTimeout` the _next_ call
   clears. Every superseded caller's promise therefore never settles — a caller
   that `await`s it hangs forever. Nothing awaits it today (all five callers use
   `.catch()`), which is why it has not bitten, and it is why the existing
   coalescing spec is `it.skip`. A debounce that returns a promise should share
   one deferred across the window.
2. **`ModelSelectorComponent` has no load path of its own.** Documented above;
   it is the reason 10.2 stopped, and it is a latent fragility regardless — the
   control's data depends entirely on another service's constructor timing.
3. **Two surfaces ask `session:list` different questions.** The sidebar wants a
   page; the dashboard wants a date-bounded metadata set. Neither is wrong and
   neither can serve the other as written. A shared workspace-scoped session
   metadata cache in a `type:data-access` lib would let both read from one
   place; that is a design task, not a remedy.
