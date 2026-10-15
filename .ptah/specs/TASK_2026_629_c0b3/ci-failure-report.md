# PR #730 CI failure report (run on d82fc59a6)

Scope: the failed jobs of PR #730 (`feat/task-629-canvas-board`). Jobs 1 and 2 are fixed in the
worktree. The changes are not committed. Jobs 3 and 4 are diagnosed only, with a proposed fix
for each failure.

Baseline used for "green on main": the latest electron-e2e runs on PR branches cut from main
(38654079210 at dfe9a3148, 38650423133, 38649716258, 38648198055) are all `success`. The
webview-e2e scheduled `main` run 38553756038 (985ea1351) and every PR run since then are
`success`. This branch is the only one that fails, so none of the failures below is
pre-existing on main.

Line numbers refer to HEAD (59ede9e11). Other writers have uncommitted edits in
`canvas-rail-card`, `canvas-rail-keyboard`, `orchestra-canvas` and `chat-ui`. Re-check the line
numbers before you apply a proposed edit.

---

## Job 1: checks / degradation-audit (116153488232). FIXED

- **Cause:** this PR added a new swallowed-failure site.
  `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:260` used
  `catch { return 'failed'; }` in `positionPanel()` (added in 61078e201, batch R9v). The audit
  rule `catch-return-sentinel` flags a catch that returns a literal without a `throw` or an
  `.error(...)` call. The rejection's cause was thrown away: `openPopover()` only logs the
  `'failed'` outcome. The other `libs/frontend/ui` site,
  `provider-model-picker.component.ts:755`, is the existing baseline of 1 and this PR did not
  touch it.
- **Classification:** PR regression in product code. It is a lint ratchet failure, not a
  behaviour bug.
- **Evidence:** `job-116153488232.log:340-341,401` reports `libs/frontend/ui: 2 FAIL (baseline 1)`.
- **Fix done:** at `native-popover.component.ts:260-266`:
  - Old: `} catch { return 'failed'; }`
  - New: `} catch (error: unknown) { if (isDevMode()) { console.error('ptah-native-popover: positioning rejected:', error); } return 'failed'; }`
  - A short comment above the log explains why the cause is kept there.
  - The new log is gated on `isDevMode()`, the same as the existing fallback log in
    `openPopover()`. The fallback behaviour (the panel is shown unpositioned) is unchanged.
  - I did not use a suppression comment and did not raise the baseline. The error was lost,
    so a `reported` marker would not have been true.
- **Verification:**
  - `node .ptah/tmp/check-run.mjs degr -- npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
    now reports `libs/frontend/ui: 1 ok (baseline 1)`, no FAIL in any directory, and a total of 296.
  - `nx test ui --testFile=.../native-popover.component.spec.ts` passed 20 of 20. The existing
    assertion `toHaveBeenCalledWith(stringContaining('positioning failed'))` still matches the
    fallback log in `openPopover`.

## Job 2: git-real-git (windows-latest) (116153488632). FIXED

- **Cause:** `git-history.reader.real-git.spec.ts:219` ("prefers origin/main over a stale
  local main...") exceeded the default 5000 ms Jest timeout. That test runs clone, `set-head`,
  fetch, checkout and several commits. The suite's `describe` (line 109) is the only real-git
  suite with no `jest.setTimeout`. Twelve of the 14 sibling suites set one (`review` 30_000,
  `paths`/`apply-hunks`/`diff-config`/... 120_000); `change-set` also has none.
- **Classification:** timing on the Windows runner, not caused by this PR.
  `git diff origin/main...HEAD -- libs/backend/vscode-core` is empty.
- **Evidence:**
  - `job-116153488632.log:30-47` shows `thrown: "Exceeded timeout of 5000 ms"` at `:219:3`.
  - The suite took 15.0 s in CI. The same suite took 69 s locally on Windows for 15 tests.
- **Fix done:** in `libs/backend/vscode-core/src/services/git-history.reader.real-git.spec.ts:109-112`,
  added `jest.setTimeout(30_000);` at the top of the `describe`, with the same rationale comment
  as `git-info.service.review.real-git.spec.ts:13-15`.
- **Verification:** `nx run @ptah-extension/vscode-core:test-real-git --testFile=.../git-history.reader.real-git.spec.ts`
  passed 15 of 15 (run under the lock).

---

## Job 3: webview-e2e (116153489643). 7 failed (each also failed its retry)

The run uploaded no artifacts (run 38652221504 has 0). Diagnosis comes from the log and the code.

### 3a. plan-limits `stats strip anubis|anubis-light 280|360|440` (6 tests)

- **Cause:** the spec waits on `[data-testid="canvas-tile"] ptah-session-stats-summary`. The
  Grid host and `canvas-tile` were removed in R9b/R9p (c8d8bc95f, 1fd6e99cb), and no product
  file renders `data-testid="canvas-tile"` any more. On main it came from
  `canvas-workspace-grid.component.ts:127`. In the Rail, the session's ChatView renders inside
  `ptah-canvas-focus-area`.
- **Classification:** stale spec selector after the Rail redesign. There is also a likely
  second, product-side problem: see the narrow-layout risk below and item 4f.
- **Evidence:**
  - `job-116153489643.log:456-480` shows `locator('[data-testid="canvas-tile"]').locator('ptah-session-stats-summary')` → `element(s) not found`.
  - The spec file is unchanged by this PR.
- **Proposed fix:** `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts:116`
  - Old: `const tile = page.locator('[data-testid="canvas-tile"]');`
  - New: `const tile = page.locator('ptah-canvas-focus-area');`
  - Also update the stale comment at lines 113-115 ("default grid layout's canvas tile").
- **Narrow-layout risk:** at the `sm` band the Rail is 272 px wide
  (`canvas-rail.component.ts:84`), and the board adds a 44 px "Open details" button
  (`canvas-rail-board.component.ts:199-207`). At 280, 360 and 440 px that leaves at most
  about 124 px for the focus pane, or nothing at all. The strip will then probably be found
  but clipped, and the `Close panel` click and the screenshots are at risk. If that happens
  after the selector fix, it is the product fix in 4f, not a spec change.

### 3b. marketplace `D2 deep link ... "Open Marketplace Skills" on the canvas landing screen` (1 test)

- **Cause:** R9p (1fd6e99cb) deleted `canvas-empty-state.component.ts`. That component mounted
  `<ptah-project-setup-card>`, which holds the "Skills Not Configured" warning, the
  "Open Marketplace Skills" button and Intelligent Project Setup (main
  `canvas-empty-state.component.ts:57`). The Rail empty board
  (`canvas-rail-board.component.ts:103-137`) does not mount it. `chat-empty-state` shows the card
  only when `showProjectSetup` is set, and its doc at `chat-empty-state.component.ts:20-23` still
  says "the Orchestra Canvas shows it on its own no-tiles screen". As a result, the skills warning
  and project setup can no longer be reached from the canvas.
- **Classification:** PR regression in product code (a feature was dropped). No decision in the
  task folder records that this removal was intended.
- **Evidence:**
  - `job-116153489643.log:382-406` shows `getByRole('button', { name: 'Open Marketplace Skills' })` → `element(s) not found`.
  - The spec file is unchanged by this PR.
- **Proposed fix (product), in `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`:**
  - Lines 1-20: add `ProjectSetupCardComponent` to the existing `@ptah-extension/chat` import on
    line 16. The chat barrel exports it at `chat/src/lib/components/index.ts:131`.
  - Lines 56-60: add it to `imports: [...]`.
  - After line 136, inside the `data-testid="canvas-rail-empty-board"` section and after the
    reason `@if`, insert `<ptah-project-setup-card class="w-full max-w-md mt-4" />`.
  - If dropping the card was intended, the spec must move instead. That needs a decision, and the
    canvas would then have no path to the skills warning.

---

## Job 4: electron-e2e shards 1/3/4 (116153488952, 116153489479, 116153489362). 17 failed

The shard totals are 12 + 1 + 4. Electron runs no retries, so these are not flakes: every failure
comes from a DOM change, as listed below. Artifacts are in
`.ptah/tmp/pr730/artifacts-electron/results-{1,3,4}/*/error-context.md` and `test-failed-1.png`.
This PR changed only three electron specs: `canvas.spec.ts`, `task-337` and `hunk-revert`. The
others still target the deleted Grid.

**Common replacement:** a former "tile" is now the focused pane. The page snapshots show that
every session that `goto('chat')` creates, or that is opened from the sidebar, renders as
`region "Focused session: <title>"`, and its ChatView is inside `ptah-canvas-focus-area`.
`ptah-canvas-focus-area` is the right scope. Rail cards also contain the marker text (their
preview line), so a bare `hasText` filter on the board is not safe.

### 4a. `canvas.spec.ts:65` Rail adds and focuses a Rail session across navigation

- **Cause:** at `:74`, `getByRole('region', { name: 'Focused session' })` hits a strict-mode
  violation because two nested regions carry the same name. The board pane wrapper has
  `aria-label=paneLabel(...)` (`canvas-rail-board.component.ts:147`). The focus area's inner
  `<section>` gets the same label through `[paneLabel]` (`canvas-focus-area.component.ts:30-31`,
  bound at `canvas-rail-board.component.ts:152`). R9w (8c9fc364a) introduced this nested
  duplicate landmark.
- **Classification:** PR regression in product code (a duplicate landmark name, an a11y defect),
  exposed by a correct spec.
- **Evidence:** `results-1/canvas-canvas-Canvas-Rail--c8922-.../error-context.md`. Its call log
  resolves two elements, `section[data-pane-side="left"]` and the inner `section.flex.h-full`.
  The snapshots of every Rail spec show `region "Focused session: X"` nested in
  `region "Focused session: X"`.
- **Proposed fix (product):**
  - `canvas-focus-area.component.ts:31`: delete `[attr.aria-label]="paneLabel()"`. The inner
    `<section>` becomes a plain container.
  - Drop the now-unused `paneLabel` input (`:86`) and its binding at
    `canvas-rail-board.component.ts:152`.
  - Update `canvas-focus-area.component.spec.ts:267,277`. That test asserts the inner section's
    label; move the label assertion to the board spec, which already checks the wrapper at
    `canvas-rail-board.component.spec.ts:1265`.
  - A spec-only fallback would be `canvas.spec.ts:74` → `page.getByRole('region', { name: /^Focused session: / }).first()`,
    but that leaves the duplicate landmark in place.

### 4b. `canvas.spec.ts:156` Swap panes changes only the visual order...

- **Cause:** the spec opens Swap from `visualPane(page, 0)`. Straight after `openSplit`, that is
  the inactive left pane: `openBeside` makes the right pane active
  (`canvas-rail-board.component.ts:556-557`). Clicking that pane's "More session actions" trigger
  fires the wrapper's `(click)` and `(focusin)="activatePane(side)"`
  (`canvas-rail-board.component.ts:147,522-535`). That moves the active side to left before the
  swap, so `:174` receives `left` when it expects `right`. This is consistent with the product
  model, where focus inside a pane activates it; a keyboard Tab into the header does the same
  thing.
- **Classification:** stale or incorrect spec assumption, authored in this PR (R9x 4cf6d4f83).
- **Evidence:** `results-1/canvas-canvas-Canvas-Rail--fede0-.../error-context.md:17-25`:
  `Expected: "right"`, `Received: "left"`. The pane is labelled `Bottom session: ..., active`.
- **Proposed fix (spec):** `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:166`
  - Old: `await headerAction(page, await visualPane(page, 0), 'Swap panes');`
  - New: ``await headerAction(page, paneContainer(page).locator(`[data-pane-side="${activeSide}"]`), 'Swap panes');``
  - Side note: because of this activation, `closePane`'s "closing the inactive pane" branch
    (`:585-597`) cannot be reached from the header UI. Record that, or change the doc comment.

### 4c. `canvas.spec.ts:186` stacked split after a swap tabs from the Rail into the visual top pane first

- **Cause:** at `:200` the spec focuses the last card's `.rc-select` and presses Tab. The next
  tabbable element is the Rail footer's "New session" button (`canvas-rail.component.ts:203-214`),
  not the pane. The snapshot shows `button "New session" [active]`. The board's `onTabKey` only
  redirects when the visual next element differs from the DOM next element, which is not the case
  here.
- **Classification:** stale spec. Its focus origin is not the last Rail tabbable element.
- **Evidence:** `results-1/canvas-canvas-Canvas-Rail--371a4-.../error-context.md`: `Received: 0`,
  and snapshot line 142 shows `button "New session" [active]`.
- **Proposed fix (spec):** `canvas.spec.ts:200`
  - Old: `await railCards(page).last().locator('.rc-select').focus();`
  - New: `await railBoard(page).locator('ptah-canvas-rail').getByRole('button', { name: 'New session', exact: true }).focus();`

### 4d. Single-tile specs that use the deleted `[data-testid="canvas-tile"]` (10 tests)

All of these are **stale spec selectors after the Rail redesign** (Grid deleted in R9b/R9p).
These spec files are not in the PR diff. The snapshots show the expected content rendered in
`region "Focused session: ..."`.

| Spec (tests) | Evidence | Fix (old -> new) |
|---|---|---|
| `chat/tile-load-older-history.spec.ts` (5: `:338,:353,:368,:385,:405`) | results-1 `chat-tile-load-older-histo-*`; the snapshot shows `PTAH_E2E_AC11_ANCHOR_ZERO_MARKER` inside `region "Focused session: AC-11 perf session ANCHOR_ZERO"` | `:43` `.locator('[data-testid="canvas-tile"]')` -> `.locator('ptah-canvas-focus-area')` |
| `git/change-set-card.spec.ts` (2: `:169,:252`) | results-1 `git-change-set-card-turn-s-*`, `> 140` | `:138` `.locator('[data-testid="canvas-tile"]')` -> `.locator('ptah-canvas-focus-area')` |
| `task-360-failed-start-leaves-tab-idle.spec.ts:89` | results-4 `task-360-*`; the snapshot has `alert "Authentication required"` inside the focused region | `:122` `'[data-testid="canvas-tile"] ptah-auth-required-banner'` -> `'ptah-canvas-focus-area ptah-auth-required-banner'` |
| `task-374-abort-then-next-turn.spec.ts:98` | results-4 `task-374-*`; the snapshot shows `button "Stop generating"` in the focused region | `:51` `const TILE = '[data-testid="canvas-tile"]';` -> `const TILE = 'ptah-canvas-focus-area';` |
| `task-337-agent-card-refresh.spec.ts:184` (this PR changed it) | results-4 `task-337-*`; R9w changed the label to `Focused session: <title>`, so the exact `[aria-label="Focused session"]` no longer matches | `:57` `'ptah-canvas-focus-area section[aria-label="Focused session"]'` -> `'ptah-canvas-focus-area'` (also safe with the 4a fix) |
| `perf/startup-tti.spec.ts:28` (shard 3) | results-3 `perf-startup-tti-*`; it waits on the deleted empty-state button `Create new session` | `:57-59` `.getByRole('button', { name: 'Create new session' })` -> `.locator('[data-testid="canvas-new-session-anchor"]')` (change `page.getByRole(...)` to `page.locator(...)`) |

### 4e. Specs that need two visible tiles (2 tests)

These are **stale specs**. The Rail shows one focused session, and a second one only after
"Open beside". Each needs a short rewrite, not just a selector swap.

- **`task-370-concurrent-session-isolation.spec.ts:109`**
  - Evidence: `> 130` `toHaveCount(2)`, received 0.
  - Fix:
    - `:52` `TILE` -> `'ptah-canvas-rail-board:visible [data-testid="rail-pane-container"] > [data-pane-side]'`.
    - After the FAB plus Create at `:125-126` (the new session takes focus in a single pane),
      open the first session beside it:
      `await page.locator('ptah-canvas-rail [data-rail-card]').first().getByRole('button', { name: 'Session actions' }).click(); await page.getByRole('menuitem', { name: 'Open beside' }).click();`
    - Then `tileA = page.locator('[data-pane-side="right"]')` (the invoked first session, active)
      and `tileB = page.locator('[data-pane-side="left"]')`, following
      `canvas-rail-board.component.ts:552-559`.
    - Replace `tileX.locator('.canvas-tile').click()` with
      `tileX.locator('ptah-canvas-focus-header').click()`, which goes through `activatePane`.
    - Replace `toHaveAttribute('data-focused','true')` with `toHaveAttribute('aria-label', /, active$/)`.
- **`chat/compaction-duplicate-session.spec.ts:52`**
  - Evidence: `> 153` `tiles toHaveCount(1)`, received 0.
  - Fix:
    - `:152` same pane locator as task-370. The first check stays at 1.
    - After `:171-172` (FAB plus Create), open the first card beside the new one as above, then
      expect 2.
    - `firstTile` = `[data-pane-side="right"]` and `secondTile` = `[data-pane-side="left"]`.
    - `:302-309`: replace `.canvas-tile[data-focused]` with the pane `aria-label` `/, active$/`,
      using `not.toHaveAttribute` for the first tile.
    - The two tabs are distinct tab ids, so `assertDistinct` (`:480-484`) allows them. The case
      still exercises two visible tabs bound to the same session.

### 4f. `git/agent-file-links.spec.ts:134`

- **Cause:** at step 3 (`:250`) the click on link `b` is intercepted by `session-viewport`. Steps
  1 and 2 opened the Git review shell, which leaves the canvas about 175 px wide (see the
  screenshot). The Rail board does not adapt: the Rail is 272 px at `sm` and the details button
  is 44 px. The focused pane, which holds the bubble, is pushed outside the `overflow-hidden`
  `session-viewport` (`orchestra-canvas.component.ts:231-235`). The rail cards themselves show as
  scrolled and clipped. On main, the Grid tile simply shrank.
- **Classification:** PR regression in product code (the Rail layout at a narrow canvas width).
  Confidence is medium; the screenshot and call log support it. It is the same root cause as the
  3a risk at 280-440 px.
- **Evidence:**
  - `results-1/git-agent-file-links-agent-1062c-.../error-context.md:15-38`: the
    `<div data-testid="session-viewport" ...> intercepts pointer events` lines.
  - `test-failed-1.png`: a canvas column of about 175 px showing only clipped rail cards, with no
    pane visible.
- **Proposed fix (product), needs a design decision:**
  - In `canvas-rail-board.component.ts:288-291`, auto-collapse the Rail (56 px) when the board
    is too narrow for a usable pane:
    ```ts
    readonly effectiveCollapsed = computed(() => {
      const width = this.layout.containerWidth();
      return this.board().railCollapsed
        || (width > 0 && width < RAIL_AUTO_COLLAPSE_PX)
        || (!this.splitDisplayed() && this.band() === 'sm' && this.detailsOpen());
    });
    ```
    with `RAIL_AUTO_COLLAPSE_PX = 640` (272 Rail + 44 details + about 320 pane).
  - Add unit specs at 0, 639 and 640.
  - A spec-only workaround would close the review shell or widen the window before step 3. That
    would hide a real usability gap in VS Code sidebar-width webviews.

### Stale, not failing in this run

These are not part of the CI failures but would break the same way. They still reference the
deleted `[data-testid="canvas-tile"]` or `Create new session`:

- `chat/tile-open-longtask-budget.perf.spec.ts:367` (skipped in CI)
- `support/perf-session-fixture.ts:466`
- `support/perf-page-capture.ts:230,250,351,491`
- `support/ui-driver.ts:456`: a dead fallback. The FAB branch is taken, because the anchor still
  has the title `Add new session tile`.
- `showcase/canvas-orchestra.scene.ts:78,121,202`
- `showcase/chat-code-edit.scene.ts:206,228,236`
- `showcase/lane-console-review.scene.ts:63,96`

---

## Decisions

1. **Job 1:** fixed by logging the rejection inside the catch (dev mode only, the same gate as
   the existing fallback log). I used no suppression marker and did not raise the baseline. The
   swallow was not legitimately "reported", because the error object was discarded, so the audit
   was right. I did not edit the popover spec; its existing assertion still holds. It could also
   assert `toHaveBeenCalledWith(stringContaining('positioning rejected'), expect.any(Error))` to
   pin the cause.
2. **Job 2:** used the sibling convention, a `describe`-level `jest.setTimeout(30_000)` with the
   same comment as `git-info.service.review.real-git.spec.ts`. I did not use per-test timeouts:
   every test in the suite spawns real git and could hit the same limit on Windows. Note that
   `git-info.service.change-set.real-git.spec.ts` also has no timeout and is a candidate for the
   same treatment. I left it alone because it is out of scope and did not fail.
3. **Classification:**
   - Product regressions from this PR:
     - 3b: setup card dropped with the canvas empty state.
     - 4a: duplicate nested `Focused session` region.
     - 4f: Rail does not adapt at narrow canvas widths. This likely also affects 3a at 280-440 px.
   - Stale or incorrect specs:
     - 3a: `canvas-tile` selector.
     - 4b and 4c: R9x spec assumptions.
     - 4d: canvas-tile and label selectors.
     - 4e: Grid-era two-tile specs.
   - Pre-existing on main or flake: none. All of these specs are green on main-based runs, and
     each failure has a deterministic DOM cause.
4. I edited no e2e spec and no canvas, chat or chat-ui product file. Canvas and chat are being
   edited by other writers, so the proposals above cite HEAD line numbers.
5. **Verification:** each check ran alone, through `.ptah/tmp/check-run.mjs` under the lock:
   - degradation audit
   - `nx test ui` scoped to the popover spec
   - `test-real-git` scoped to the git-history spec

   I ran no e2e, build or workspace-wide check.
