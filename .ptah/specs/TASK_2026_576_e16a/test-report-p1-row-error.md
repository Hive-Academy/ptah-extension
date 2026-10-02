# Test Report (P1 row error) - TASK_2026_576_e16a

Branch feat/task-2026-576-git-review, HEAD a925edcc2 (Batch 5).

## Scope

- Requirement: batches.md:619-623, visual-review.md:435-450 - after a failed `git:stage` of one row, the row error (`data-testid="git-row-error"`, `role="alert"`) is visible, dismissible via its 24x24 dismiss button (section-unique aria-label), and the row's Stage button is re-enabled.
- Spec: `D:/projects/ptah-extension/apps/ptah-electron-e2e/src/specs/git/row-stage-failure.spec.ts` (Electron e2e, real RPC, real git, nothing mocked). No production code or shared helper changed.

## How the failure is forced

The spec holds a real `.git/index.lock` in the scratch repo. The app's real `git add` fails, Batch 5's write lock retries ~3.1 s, and `git:stage` returns `{ success:false, code:'LOCKED', error:'Another git process is using this repository.' }`. It is deterministic on every OS, needs no mocks, and the file is removed in a `finally` (plus an `existsSync` assertion; the scratch repo is also cleaned by the fixture).

## Assertions

1. RPC observed (separate from UI): a main-process observer (additive `ipcMain.on('rpc')` recorder plus a `webContents.send` tap for `to-renderer`; spec-local because `UiDriver.getObservedCalls` only exists under the fake-RPC listener the real fixture avoids). Asserts `git:stage` targeted `['src/calc.ts']` and answered `success:false, code:'LOCKED', error === GIT_LOCKED_MESSAGE`; git confirms nothing staged. RPC wait budget is 30 s, named `STAGE_RPC_BUDGET_MS`: ~3.1 s lock retry + cold Windows git spawn (first spawn was 1.2-10 s in the fixture gate) + slack.
2. UI after the RPC failure is confirmed: `git-row-error` visible with Playwright's DEFAULT 5 s expect timeout (no sleep); count 1; `role=alert` text equals the lock message exactly; no `index.lock` / `fatal:` raw stderr.
3. The error survives the post-mutation refresh (row and error still visible).
4. Stage button enabled and no `aria-busy`.
5. Dismiss button `Dismiss error for calc.ts in changes` visible, bounding box >= 24x24; clicking removes the error, row intact, Stage enabled.
6. Causation control: lock removed, Stage clicked again -> `git:stage` succeeds, row appears under Staged files, no row error, git shows a staged diff.

Test-defect note: the first draft's Stage locator matched two buttons because the app adds an untracked `.mcp.json` to the workspace; the locator is now scoped to the `src folder` list. Not a product defect.

## Execution (all from D:/projects/ptah-extension unless noted)

- Run 1 (fresh build): `npx nx run ptah-electron-e2e:e2e --skip-nx-cache -- src/specs/git/row-stage-failure.spec.ts --reporter=list` -> `1 passed (2.7m)`
- Runs 2-4 (no rebuild), from apps/ptah-electron-e2e: `npx playwright test --config=playwright.config.ts src/specs/git/row-stage-failure.spec.ts --reporter=list`
  - Run 2: `1 passed (2.8m)`
  - Run 3: `1 passed (3.0m)`
  - Run 4: `1 passed (2.6m)`
- Extra run 5 after a type-only fix (below): `1 passed (2.6m)`. An earlier iteration run of the pre-fix spec also passed once after the locator scoping fix (`1 passed (2.6m)`).
- Regression check, same directory: `npx playwright test --config=playwright.config.ts src/specs/git/commit-hook-failure.spec.ts --reporter=list` -> `1 passed (2.6m)`
- Typecheck: `npx nx run ptah-electron-e2e:typecheck` -> first attempt failed with 6 TS errors in my spec (`never[]` inference in the observer); fixed with a typed array; re-run: `Successfully ran target typecheck for project ptah-electron-e2e`.
- The ~2.6 min duration is dominated by the real-boot fixture (ptahHome/migrations/teardown), the same as commit-hook-failure.spec.ts (2.6m).

## Verdict

- Did the timing issue reproduce? No. In all 5 passing runs the row error was visible within the default 5 s expect timeout after the confirmed `git:stage` LOCKED response, and stayed visible through the refresh. This is consistent with Batch 5's git-dock change (panel no longer unmounted while `isLoading()`), though this spec proves the behaviour, not that specific cause.
- Not measured: exact ms between RPC response and error render (the observer records `respondedAt`, but the spec asserts the bound, not the number). Failure kinds other than LOCKED (raw GIT_ERROR text path) are not covered here.
- Risk: the lock-based failure exercises the `code === 'LOCKED'` message mapping; a GIT_ERROR row failure follows the same `setError`/render path but is not separately pinned.
