# PR #881 Electron hunk-revert e2e diagnosis

## Evidence

- CI run `41390065023` checked out merge ref `c386999992074371b2193f8aef40670f5df59b94` (`df293fb9c` into main `d7bc04d66`), not the branch head alone. Shard 2/4 logged the failure at `hunk-revert-top-layer.spec.ts:174` at 04:55:08 UTC; the second hunk-revert test at line 242 passed at 04:55:16. Its summary was **1 failed, 52 passed**. `89510cb0f` is an ancestor of the main parent of this merge.
- Downloaded `electron-test-results-2` outside the repository. `test-failed-1.png` shows the **Settings → Providers** page behind the native “Reject this hunk?” dialog. The main agent is **Claude (Subscription)**, marked **Needs attention / Not configured**. This is not a Codex refusal screen or an alternate rail layout. `error-context.md` confirms the Settings h1 and the same provider state in the accessibility tree. The dialog and Git dock remain visible.
- The failure is `apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts:197-198`: the locator for the empty-board h1 never enters the accessibility tree in 30 seconds. The preceding setup calls `ui.goto('git')`, opens Workspaces, then `showCanvas(ui)` at lines 180-185; it opens the hunk dialog at line 190.
- The Playwright `trace.zip` records `canvas-grid` visible at trace time 237211-237216 ms. `showCanvas` then waited from 237217 to 242217 ms for the absent update dialog's “Later” button; that timeout was intentionally swallowed. The hunk dialog opened at 242260-242280 ms, and the empty-board heading assertion began at 242402 ms. The screenshot at failure shows Settings. The trace does not timestamp the route switch itself, but brackets it after the last observed canvas visibility and before the screenshot.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-empty-board.component.ts:94-143` renders `<main data-testid="canvas-rail-empty-board">` and its workspace-name h1. `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:126,155-166` mounts it only when the board is visible and `orderedTiles().length === 0`; lines 371-377 derive tiles from the current workspace. A chunk-load error uses `canvas-empty-board-error` at lines 179-195. Here Settings, not that error, occupies the screen.
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:275-304` starts a one-shot `auth:getAuthStatus` read on Chat and routes to Settings if `hasAnyAuth()` is false and Chat remains current. `libs/frontend/core/src/lib/services/auth-state.service.ts:449-468` defines that condition. `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:110-115` retains but hides/detaches shared canvas chrome on a standalone route, explaining why Playwright reports the h1 as **element(s) not found**.
- The spec uses `real-rpc-fixtures.ts:24-28,245-268`: a fresh home, real RPC, no seeded startup config or fake auth. The unconfigured Claude state in the screenshot matches that setup. `active-provider-resolver.ts:60,155-161` defaults an unconfigured auth method to `claudeCli` and maps it to the direct Anthropic provider. The fixture does not select Codex.
- `show-canvas.ts:28-36` retries `ui.goto('canvas')` until **the grid** is visible, then performs the five-second update-dialog probe. It does not recheck the route or the empty-board heading afterward. `ui-driver.ts:356-375` likewise returns after the grid is visible. This lets the async auth redirect overtake the helper after it reports success.
- The three same-selector assertions in `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:64,71-75,143` passed in shard 1/4 (04:51:14, 04:51:18, and the workspace round-trip test starting at 04:51:31). That file imports `support/fixtures` at line 2, which mocks RPC; this failing spec imports `support/real-rpc-fixtures` at line 4. Their passing result confirms the board can render on this merge, but does not validate the real-auth startup sequence.

## Root cause and branch assessment

**High confidence in the immediate cause:** the test's precondition (empty canvas behind the dialog) was lost to the asynchronous no-auth redirect. `showCanvas` observed the grid too early, spent five seconds probing for an unrelated update dialog, and never restored or revalidated Chat. The test then opened the Git dialog over Settings and asked for a canvas heading that was hidden/detached.

**Low confidence in a branch-specific trigger:** `git log main..HEAD` contains the A2/A3 Codex proxy/native-runtime refusal and D9 native history/sub-agent changes, but `git diff main...HEAD -- libs/frontend apps/ptah-electron-e2e apps/ptah-extension-webview` is empty. The auth redirect and `auth:getAuthStatus` aggregation are unchanged by this branch; the fixture has no Codex selection, and the screenshot identifies Claude. The new backend composition could shift startup timing, but the trace does not prove which change moved the auth response into this window. Both reported PR heads failing and main/other branches passing are consistent with a timing shift exposing this existing helper race; they do not establish a Codex-auth state regression.

`89510cb0f` changes rail grouping, focus/order handling and presentation. Its diff in `canvas-rail-board.component.ts` leaves the `orderedTiles().length === 0`/`@defer` branch and `canvas-rail-empty-board` h1 unchanged. Because the failed screenshot is on Settings, the grouped rail cannot be the direct reason for the missing h1. It may change render timing, but no causal timing evidence isolates it.

## Minimal fix proposal

Fix the spec helper at `apps/ptah-electron-e2e/src/support/show-canvas.ts:28-36`: make the **final** navigation and success check occur after the update-dialog probe, and check the actual empty-board h1 rather than only `canvas-grid`. For the observed trace, a minimal change is:

```ts
await dismissUpdateDialog(ui);
await expect(async () => {
  await ui.goto('canvas');
  await expect(
    ui.page
      .locator('[data-testid="canvas-rail-empty-board"]')
      .getByRole('heading', { level: 1 }),
  ).toBeVisible({ timeout: 1_000 });
}).toPass({ timeout: 60_000 });
```

Replace the current `await dismissUpdateDialog(ui);` tail with this block. Keep the geometry and unforced mouse-click assertions at `hunk-revert-top-layer.spec.ts:197-238`; they guard the actual bug. The second navigation repairs the route if the one-shot auth redirect landed during the five-second probe, and the h1 check verifies the required state. For a fully deterministic guard against an auth response arriving *after* that final check, first await the frontend auth check/redirect outcome in this real-RPC fixture, then navigate to Chat and assert the h1; do not add an arbitrary sleep or change provider configuration to Codex.

## Investigation limits

Read-only investigation only: no tests, checks, workflow reruns, or source edits. The screenshot and trace are from the downloaded CI artifact. Native skill discovery/invocation was unavailable in this CLI tool list; `rg` was present but failed with Access denied, so source text search used read-only `git grep` and PowerShell `Select-String`.
