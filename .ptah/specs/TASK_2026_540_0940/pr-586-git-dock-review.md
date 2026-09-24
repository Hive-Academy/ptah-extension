# Review — PR-586 fix for `git-dock.spec.ts` diff-tab flake

Scope: `git diff -- apps/ptah-electron-e2e/src/specs/git/git-dock.spec.ts` only,
against the lane's account at
`.ptah/specs/TASK_2026_540_0940/pr-586-fix-git-dock.md`.

## Verdict: APPROVE

## 1. Resolver mechanism — correct and round-trips cleanly

- `ui.mockRpc` (`apps/ptah-electron-e2e/src/support/ui-driver.ts:186-216`) routes a
  string value into `__uiMockFns`, distinct from the `__uiMockStatics` path used by
  object values.
- The main-process handler (`ui-driver.ts:82-153`) reads `rpcData['params']` off the
  raw IPC message (`ui-driver.ts:100-102`) and, for a function-mock method, compiles it
  with `new Function('params', ...)` (`ui-driver.ts:126-129`)
  and calls `resolver(params)` (`ui-driver.ts:133`). So the fix's
  `(params) => (...)[params.path]` receives the full RPC params object, unmodified.
- `GitDiffFileParams` (`libs/shared/src/lib/types/rpc/rpc-git.types.ts:339-345`) declares
  `path: string` as the workspace-relative modified-side path — `params.path` is the
  right field, and it matches what `DiffTabsService.requestDiff` actually sends
  (`libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts:684-693`, `path` first key
  of the params object).
- `gitDiffFileMock` (`apps/ptah-electron-e2e/src/support/git-diff-mock.ts:73-107`) returns
  a `GitDiffFileResult` built entirely from strings, numbers and plain nested objects/arrays
  (`original`/`modified` are `{outcome:'content', content: string}`, `originalRef`/
  `modifiedRef` are `{kind: 'index'|'worktree'}`, `hunks` is `GitHunkRef[]` of numbers and a
  header string, `patch` is `string | null`). Every field the builder fills is a required
  field on `GitDiffFileResult` (`rpc-git.types.ts:371-395`) and none is optional-and-omitted,
  a function, a `Map`, or `undefined`. `JSON.stringify(diffByPath)` therefore loses nothing
  a real backend reply would carry, and JSON's string escaping is a strict subset of valid JS
  string-literal escaping, so embedding it in the `new Function` source is safe even for the
  multi-line diff `patch` text.

No defect found in the resolver mechanism.

## 2. Is the re-request hypothesis plausible? Yes — and I traced the exact trigger

The lane's account says "e.g. on a refresh" without naming the trigger. I traced it:

- `DiffTabsService.onGitStatusUpdate` (`diff-tabs.service.ts:395-415`) is invoked from
  `handleMessage` on every `GIT_STATUS_UPDATE` message (`diff-tabs.service.ts:206-216`) and
  arms a **250 ms debounce timer** (`DIFF_REFRESH_DEBOUNCE_MS`, `diff-tabs.service.ts:113`)
  that calls `refreshAllDiffTabs()` (`diff-tabs.service.ts:406-408`), which re-requests
  `git:diffFile` for **every currently open diff tab** (`diff-tabs.service.ts:468-473`),
  each using that tab's own stored `path` (`diff-tabs.service.ts:492,503`) — so the request
  itself is always correct, but the OLD single-static-mock reply was not: it returned
  whatever payload was installed most recently regardless of which path was requested.
- The test pushes exactly one `git:status-update`, at
  `git-dock.spec.ts:255-270`, **before either tab is opened**. That push arms the 250 ms
  timer immediately. Because several `await expect(...)` calls with real wall-clock waits
  sit between that push and the second (pre-fix) `mockRpc` swap, the timer is very likely to
  fire after the alpha tab exists but after (or during) the swap to the beta-only static
  mock — i.e. exactly the "already-open tab re-requests after the swap" race the lane
  describes.
- The response overwrites the tab's displayed identity, not just its content:
  `toDiffState` copies `path: result.path` onto the tab record
  (`diff-tabs.service.ts:715`), `applyFreshDiff` writes that into the tab
  (`diff-tabs.service.ts:794` region), and the tab title is computed from that same
  `diff.path` in `labelFor` → `diffTabLabel(extractFileName(diff.path), ...)`
  (`diff-tabs.service.ts:780-791`). So a stale refresh that returns beta's payload for the
  alpha-keyed tab renames the alpha tab to `beta.ts (working tree)` while leaving it at its
  original tab position — producing exactly the CI symptom (two tabs both titled
  `beta.ts (working tree)`, ids `git-diff-tab-0-0` and `git-diff-tab-0-1`).
- The fix removes the exposure by making the single registered resolver correct for
  **every** path from the start, so no matter when the 250 ms timer's refresh lands (before
  or after beta opens, once or twice), each tab's re-request gets its own tab's payload.

I did not find a second, independent path that could also produce two `beta.ts` tabs (e.g.
a double-fire of the beta open click, or `openDiff` refreshing a sibling tab — `openDiff`
only requests the tab being opened, `diff-tabs.service.ts:239-273`). The debounced
`git:status-update` refresh is sufficient on its own to explain the failure, and the fix
closes exactly that gap.

## 3. No other findings

- No assertion in the test changed — confirmed by the diff (only the mock setup block
  changed; every `expect(...)` after it is untouched) and by reading the full test through
  its end (`git-dock.spec.ts:305-348`).
- No other test in the file depends on the removed second `mockRpc` call: `git:diffFile` is
  mocked only inside this one test (`grep` for `mockRpc`/`git:diffFile` across the file shows
  the other three `mockRpc` calls target unrelated methods, and the CX:120 test only reads
  `getObservedCalls('git:diffFile')`, an observed-call log rather than mock state,
  `git-dock.spec.ts:231`). Each test launches a fresh Electron app
  (per `ui-driver.ts`'s per-test fixture lifecycle), so there is no cross-test mock leakage.
- `ptah_get_diagnostics` on the changed file: 0 errors, 0 warnings (typescript-compiler).

## Findings

None blocking. None serious. None moderate.

## Recommendation

APPROVE. The resolver correctly reads `params.path`, the JSON round-trip loses no data
against the `GitDiffFileResult` contract, the re-request hypothesis is not just plausible
but traceable to a specific mechanism (the 250 ms `git:status-update` debounce refreshing
every open diff tab against a since-swapped static mock), and the fix removes that
race without touching any assertion or affecting other tests.
