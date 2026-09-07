# Code Logic Review — `TASK_2026_385` Batch 3.1

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 2        |

Scope reviewed: `git-dock.component.ts`, `git-dock-header.component.ts`, `git-dock.component.spec.ts`, `electron-shell.component.ts` (the `dockComponent` signal/effect and its template only). `GitStatusService` and `GitBranchesService` were read in full even though outside the file list, because the batch's stated purpose — arming the push gate — cannot be verified without reading `startListening`/`stopListening`/`handleMessage` in both. `app.config.ts`'s `MESSAGE_HANDLERS` block (lines 117-193) was read to confirm singleton wiring.

## Five logic questions

### 1. How does this fail silently?

- `electron-shell.component.ts:307-309` — `import('@ptah-extension/git-ui').then((m) => this.dockComponent.set(m.GitDockComponent))` has no `.catch()`. If the dynamic import rejects (chunk 404, corrupted asar, CSP block), the promise rejection is unhandled and `dockComponent` stays `null` forever for that toggle. The user sees the `loading loading-spinner` placeholder (`:268-272`) with no error, no retry affordance, and nothing distinguishes "still loading" from "failed forever." It self-heals only if the user closes and reopens the git tab, because the effect re-runs on `editorPanelVisible()` changing and `untracked(this.dockComponent)` is still falsy (`:302-311`) — but nothing tells the user to do that.
- `GitBranchesService.push()` (`git-branches.service.ts:505-532`) and `GitBranchesService.safeRpc` (`:539-558`) both catch and log to `console.error`/`console.warn` only — a push failure surfaces through the returned `GitPushResult.error`, which `GitDockHeaderComponent.onPush()` (`git-dock-header.component.ts:124-132`) awaits but never reads; the `try/finally` only clears `isPushing`. A failed push leaves the header showing the same "Push N commit(s)" button with zero user-facing feedback that it just failed. This is pre-existing behaviour ported from `git-status-bar.component.ts`, not new in this batch, but it is in the reviewed file and still a silent-failure path.

### 2. What user action produces unexpected behaviour?

Rapidly toggling the git dock tab open/closed while the dynamic import (`electron-shell.component.ts:307`) is still in flight fires the effect a second time and calls `import()` again before the first resolves (`untracked(this.dockComponent)` is still `null`). Native ES dynamic `import()` is cached per specifier, so this does not double-fetch or double-register the module, but it means the effect can be re-entered arbitrarily many times before the signal is ever set — none of this is guarded with an in-flight flag. Functionally harmless today only because the platform's import cache absorbs it; a mock/test double for `import()` would not.

### 3. What input data produces a wrong answer?

None found for the reviewed files themselves — `GitDockComponent` and `GitDockHeaderComponent` are pure composition/read layers over the two services' signals, with no data transformation of their own that could be fed a malformed value. `GitDockHeaderComponent`'s `isPushing` guard (`:125`) correctly no-ops a second click while a push is in flight.

### 4. What happens when a dependency fails?

- `GitStatusService.fetchGitInfo()` (`git-status.service.ts:284-305`) is called un-awaited from `startListening()` (`:229`) with no `void` and no `.catch()`. Per `rpc-call.util.ts:203-210`, `rpcCall` delegates to `getClient().call(...)`, which — per the class's own doc comment ("type-safe async RPC with timeout/retry") and its use unguarded everywhere else in this codebase (e.g. `onFileClicked`'s `void rpcCall(...)`) — is expected to always resolve to an `RpcCallResult`, never reject. This is pre-existing infrastructure, not introduced by this batch, so I did not re-verify `ClaudeRpcService` internals; if that contract were ever violated, `startListening()`'s un-awaited call would become an unhandled rejection with no user impact beyond a console error, since no state write depends on it succeeding.
- `void this.gitBranches.refreshBranches()` (`git-dock.component.ts:86`) traced end to end: `refreshBranches` → `refreshForCauses` → `requestRefresh` → `runRefreshPass`, whose only RPC calls go through `safeRpc` (`:539-558`), which catches every error and returns `null`. `Promise.all(tasks)` therefore never rejects, and `_passPromise` is only ever resolved (`:339`), never rejected. The `void` here is verified safe — a genuinely non-throwing coalesced refresh.
- If the `git-ui` chunk itself fails to load (see Q1), the dock never mounts and neither `GitStatusService` nor `GitBranchesService` is armed for that session until the user retries the toggle — the push gate documented at `git-status.service.ts:269` stays permanently closed for that render, which is exactly the bug class this whole batch exists to close, reintroduced at one remove (import failure instead of missing armer).

### 5. What is missing that the requirements never mentioned?

- No test proves the constructor's `inject(GitStatusService)` / `inject(GitBranchesService)` resolve to the _same_ singleton instances registered in `app.config.ts`'s `MESSAGE_HANDLERS` multi-provider (`:190-191`). I verified this by reading both services (`@Injectable({ providedIn: 'root' })`, no component-level `providers` override in `git-dock.component.ts`) and the provider list (`useExisting: GitStatusService` / `useExisting: GitBranchesService`), confirming DI resolves to the same root instance today. But the spec uses `useValue` stubs (`git-dock.component.spec.ts:107-108`) that bypass real DI resolution entirely, so a future regression — e.g. someone adding `providers: [GitStatusService]` to `@Component` for an unrelated reason — would break the arming chain silently and no test in this batch would catch it.
- No error surface for the dynamic-import failure path (Q1) was specified anywhere in `batches.md:525-539`, but it is a real gap the requirements didn't anticipate.

## Failure modes

### Dynamic import of `@ptah-extension/git-ui` rejects silently

- Trigger: chunk load failure (network blip serving the lazy bundle, corrupted build output, CSP restriction).
- Symptom: git dock tab shows a permanent loading spinner; no error text, no retry button. Toggling the tab closed and back open silently retries because `dockComponent` is still `null`, but nothing tells the user to do that.
- Evidence: `electron-shell.component.ts:307-309`.
- Current handling: none — `.then()` with no `.catch()`.
- Recommendation: add a `.catch()` that logs and sets a distinct "failed to load" signal so the template can render an error state with a manual retry action, instead of an indefinite spinner.

### Push failure has no user-facing feedback

- Trigger: `git:push` RPC returns `{ success: false, error }` or the transport throws.
- Symptom: the push button becomes clickable again (`isPushing` cleared) with zero indication anything went wrong; the ahead-count badge is unchanged since no refresh happened, so the user's only signal is that "Push" is still there.
- Evidence: `git-dock-header.component.ts:124-132`; `git-branches.service.ts:505-532`.
- Current handling: result is awaited and discarded; only logged to `console.error` inside `push()`.
- Recommendation: surface the returned `GitPushResult.error` (e.g. a transient toast or inline banner) — this is a pre-existing gap from the ported `git-status-bar.component.ts`, not introduced here, but it moved into this batch's file and is worth flagging as carried-over debt.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: unhandled dynamic-import rejection, `electron-shell.component.ts:307-309` (see Failure modes).
- Moderate: no test exercises the real DI graph that makes arming work — the spec's `useValue` stubs (`git-dock.component.spec.ts:104-113`) prove the _component's own_ logic calls the right methods, but not that `inject(GitStatusService)` in this component and the `useExisting: GitStatusService` provider in `app.config.ts:190` resolve to one instance. This was true when read, is exactly the fact the whole batch depends on, and has no regression guard.
- Minor: push-failure feedback gap carried over into this batch's file, `git-dock-header.component.ts:124-132` (pre-existing, not newly introduced).
- Minor: `GitDockComponent`'s body always renders `ptah-source-control-panel` regardless of `gitStatus.isGitRepo()` (only the header is gated on it, `git-dock-header.component.ts:35`), so a non-git workspace shows an empty file-list panel with no "not a git repository" messaging. `SourceControlPanelComponent` itself is out of this batch's scope, so this is an observation, not a defect attributable to the reviewed files.

## Data flow

1. `ElectronShellComponent` constructor registers an `effect()` (`:302-311`) — OK, correctly gated on `editorPanelVisible()` and `untracked(dockComponent)` to import exactly once per successful load.
2. User opens the git tab → `layout.editorPanelVisible()` flips true → effect fires → dynamic import → `dockComponent.set(GitDockComponent)` — OK on the happy path; gap on import rejection (see Failure modes).
3. `NgComponentOutlet` instantiates `GitDockComponent` → constructor runs synchronously: `gitStatus.startListening()` (arms + eager `git:info` fetch), `gitBranches.startListening()` (arms only, no fetch), `void gitBranches.refreshBranches()` (coalesced fetch of branches/stash/lastCommit) — OK, matches the documented contract and traced to non-throwing internals.
4. `destroyRef.onDestroy` registers both `stopListening()` calls — OK, fires when the outer `@if (layout.editorPanelVisible())` in the parent template removes the dock subtree from the DOM.
5. Inbound `git:status-update` pushes route through `MessageRouterService` (core lib) to both services' `handleMessage` (gated on `_isListening`) — OK, verified both services are registered as the same root singletons the component injects, so a push routed to the registered instance is visible to the component's own signal reads.
6. Dock closes → both services disarm; `_isListening` is `false` in both, so pushes arriving in the gap are dropped as intended, and reopening re-arms with a fresh eager fetch in `GitStatusService` (reconciling any missed pushes) — `GitBranchesService` has no eager fetch inside `startListening()` itself, but `GitDockComponent`'s constructor separately calls `refreshBranches()` every time it (re)constructs, which covers the same reconciliation need. OK.

## Requirements fulfilment

| Requirement                                                                         | Status                     | Gap                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Constructor arms `GitStatusService` + `GitBranchesService`, disarms both on destroy | COMPLETE                   | None — traced and confirmed non-throwing.                                                                                                                                                                                                                                                        |
| `startListening()` eager fetch makes re-arming idempotent                           | COMPLETE                   | Confirmed via `GitStatusService.startListening`/`fetchGitInfo`; `GitBranchesService` relies on the component's explicit `refreshBranches()` call rather than its own `startListening()`, which is what the plan text (`batches.md:532`) actually specifies, so this matches the spec as written. |
| Selectors `ptah-git-dock` / `ptah-git-dock-header` with the required `data-testid`s | COMPLETE                   | `git-dock.component.ts:47`, `git-dock-header.component.ts:39`.                                                                                                                                                                                                                                   |
| Keep `data-testid="git-push-button"`, `role="status"`, `aria-label="Git status"`    | COMPLETE                   | `git-dock-header.component.ts:39-41,92`.                                                                                                                                                                                                                                                         |
| No branch-picker dropdown / details popover ported                                  | COMPLETE                   | Confirmed absent from both files.                                                                                                                                                                                                                                                                |
| Shell mount renames `editorComponent` → `dockComponent`, sidebar label → "Git"      | COMPLETE                   | `electron-shell.component.ts:294`, `:277-282`; grep found zero stale `editorComponent` readers anywhere in `libs/frontend/chat`.                                                                                                                                                                 |
| Same singleton services resolved by dock and by `MESSAGE_HANDLERS`                  | COMPLETE (by code reading) | No automated test proves it — see Moderate issues.                                                                                                                                                                                                                                               |

Implicit requirements not addressed: dynamic-import failure handling; push-failure user feedback (pre-existing debt, not newly introduced).

## Edge cases

| Case                                    | Handled             | How                                                                                                 | Concern                                                                                    |
| --------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Dock closed then reopened (re-arm)      | YES                 | New `GitDockComponent` instance re-runs constructor; `GitStatusService.startListening()` re-fetches | None — spec `git-dock.component.spec.ts:139-147` pins this.                                |
| `refreshBranches()` rejecting           | YES (never rejects) | Traced through `safeRpc`'s catch-all                                                                | None — verified safe despite the bare `void`.                                              |
| Dynamic import failure                  | NO                  | No `.catch()`                                                                                       | Permanent spinner until next toggle; see Failure modes.                                    |
| Rapid open/close before import resolves | PARTIAL             | Import cache absorbs duplicate calls                                                                | No in-flight guard; harmless today but implicit on platform behaviour.                     |
| Push RPC failure                        | NO                  | Result discarded after `finally` clears `isPushing`                                                 | Silent to the user; pre-existing pattern.                                                  |
| Non-git workspace                       | PARTIAL             | Header hides itself (`isGitRepo()` gate)                                                            | File-list body still renders empty with no messaging; out of this batch's component scope. |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the dynamic-import `.then()` with no `.catch()` in `electron-shell.component.ts:307-309` can leave the dock — and therefore both services' arming — permanently unmounted for a session if the lazy chunk ever fails to load, with no error surfaced to the user.
- What a robust implementation would add: a `.catch()` on the dynamic import with a distinct failed/retry UI state; a DI-integration test (or an `app.config.ts` provider-graph assertion) that proves `GitDockComponent`'s injected services are identical references to the ones registered in `MESSAGE_HANDLERS`; user-facing feedback on `git:push` failure.
