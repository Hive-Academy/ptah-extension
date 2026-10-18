# Code Logic Review B0 - TASK_2026_683_3c29

Reviewer: Claude (independent). Scope: `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts` (417 lines, read in full), the three support helpers, the plan sections 9, Measurement plan and B0, and the app sources the selectors target. Nothing was run (no Electron, nx or Playwright), so every "will fail" below is derived from reading the code paths, not from an observed run.

## Summary

| Metric | Value |
| --- | --- |
| Score | 4/10 |
| Verdict | NEEDS_FIXES |
| BLOCKING-M0 | 4 |
| Serious | 7 |
| Moderate | 8 |

The harness structure is sound (one test, helpers reused, label validation, repo-root path, per-window CDP sessions detached on the normal path). But the M0 run as written will most likely die before it writes any JSON, and where it does not die, the entrance/scroll samples read the wrong transcript and are anchored to probe installation rather than to the click.

## BLOCKING-M0 (run fails or records empty/wrong data)

### 1. `getByTitle('C:\\ptah-e2e-ws')` is a substring match: strict-mode violation after S7 (line 369)

- `page.getByTitle('C:\\ptah-e2e-ws').click()` matches both `title="C:\ptah-e2e-ws"` and `title="C:\ptah-e2e-ws-2"` (workspace-sidebar.component.ts:67, one element per folder). Playwright `getByTitle` is substring and case-insensitive unless `exact: true`. Result: "strict mode violation: resolved to 2 elements", thrown after S1-S7 have run and before `writeFileSync` (line 387). All data is lost.
- Fix: `page.getByTitle('C:\\ptah-e2e-ws', { exact: true })`. Do the same for line 366 for symmetry. Better: scope to the sidebar (`page.locator('ptah-workspace-sidebar [title="C:\\\\ptah-e2e-ws"]')`) so the chat-input `[title]="workspaceRoot()"` (chat-input.component.ts:221) cannot also match.

### 2. S8 opens "Open beside" on the card that is already focused: aria-disabled click waits 15 s and fails (lines 373-379)

- After S6 the last action is `cards().nth(9 % 4)` = card 1 (line 331), which is focused. Line 375 then opens the actions menu of `cards().nth(1)`. `CanvasRailComponent.cardSplitReason` returns `SPLIT_ALREADY_FOCUSED_REASON` for the focused card (canvas-rail.component.ts:304-308) and the menu item gets `aria-disabled="true"` (canvas-rail-card.component.ts:209). Playwright treats `aria-disabled=true` as not enabled, so line 376 `click()` retries until `actionTimeout` (15 s) and throws. Same on the second loop iteration (the card that was opened beside is the focused one) and again in the reduced pass. Lost data as in item 1.
- Fix: before opening the menu, focus a different card and open the menu on a non-focused one, every iteration: `await cards().nth(0).click(); await cards().nth(2).getByRole('button', { name: 'Session actions' }).click();`. Optionally assert `await expect(page.getByRole('menuitem', { name: 'Open beside' })).not.toHaveAttribute('aria-disabled', 'true')` so a regression gives a clear message.

### 3. Active-transcript lookup returns a hidden retained transcript (lines 95, 127, 170)

- `document.querySelector('[data-testid="chat-transcript-scroller"]:not([inert])')` returns the first scroller in DOM order. Inactive retained transcripts are not inert: they are hidden by the host `[class.hidden]="!active()"` (chat-transcript.component.ts:276) and `[attr.inert]` is only set for an open subagent (chat-transcript.component.html:12). With four retained transcripts mounted (chat-view.component.html:102-115), the first match is a `display:none` scroller for S2, S3, S4, S5, S6 and S8.
- Effects: `sample()` computes `sr` as an all-zero rect, so no placement is ever `visibleAt50Ms`, `firstVisibleIndex/DelayMs` are always null, and `scrollFrames` records the hidden scroller's scrollTop/height, not the active one. F6 (first-frame scroll) and A7/U5 (entrance placement) are therefore unmeasured at M0, and at M1 the assertion at lines 407-411 passes vacuously (`animated.length` is 0 because hidden transcripts never animate).
- Fix: select the visible one: `[...document.querySelectorAll<HTMLElement>('[data-testid="chat-transcript-scroller"]')].find((el) => el.getClientRects().length > 0 && !el.closest('[inert]'))`, shared by `sample`, `readScroll` and the initial `scroller` (extract one in-page helper, since the callback is stringified). Same fix for `composerRect` (`ptah-chat-input`, line 160) and `headerRect`, which also take the first match.

### 4. No incremental or failure-path write: any throw loses the whole run (lines 224-281, 386-387)

- `measure()` has no try/finally, and rows are only written once at line 387. A single selector timeout (items 1, 2, or any unforeseen selector) discards up to ~100 recorded windows plus the time spent. Cleanup of the CDP sessions is fine in that case only because the fixture closes the app (fixtures.ts:57-64), but the data is not.
- Fix: wrap the scenario body in `try { ... } finally { writeFileSync(join(outputDir, `${label}${completed ? '' : '.partial'}.json`), ...) }`, and write after each scenario. Also wrap `measure()` internals in try/finally so the screencast/trace session is stopped on a thrown `action()`.

## Serious

### 5. Sample timers, rAF chain, window and screencast are anchored to probe installation, not to the click (lines 164-174, 246-250, 261)

- `installWindowProbe` starts `at0/at50/at100/at400` and the 3-rAF scroll read immediately (lines 164-174). The click happens afterwards, after `page.evaluate(performance.now())` and Playwright's actionability wait (visible, stable over two frames, receives events), typically tens to hundreds of ms later. So "+50 ms" and the three first-frame rAFs mostly sample the pre-click state, the "+400 ms" focus is ~300 ms after the click, `windowStartMs` (line 247) precedes the click and the 600 ms long-task filter (line 261) clips the response tail, and screencast `atMs` is relative to `started` (line 248), not the click. The plan requires +50/+400 ms after the click and scroll in the first three frames after it.
- Fix: arm everything from the capture-phase click listener already installed (line 104-105): on the first trusted click record `t0 = performance.now()` and start the timeouts and rAF chain there (also arm on first `keydown` for the S7 keyboard window). Store `t0` in the probe, return it, and use `[t0, t0+600)` for the long-task filter and `windowStartMs`. Compute the post-action wait in page time (`610 - (now - t0)`). For frames, store `payload.metadata.timestamp` and convert to ms relative to `performance.timeOrigin + t0` after the fact; keep frames from ~100 ms before to 650 ms after the click instead of dropping frames older than `started` (line 237 uses `atMs <= 650` from `started`). If no click was seen, fall back to the end-of-action time and record `armed: false` rather than throwing at line 268.

### 6. M1 trace-based criteria cannot ever fail: attribution is vacuous (lines 32, 192-200, 402-405)

- `forcedLayouts` looks for `stackTrace|stackFrames|functionName|url` in `Layout` event args, but the shared `startTraceCapture` does not enable `disabled-by-default-devtools.timeline.stack`, so Layout events carry no stack (perf-page-capture.ts:154-165). `motionLongTasks` tests the regex against a `RunTask` event's own args, which hold no JS frames. Both are always 0, so `motionForcedLayouts` and `motionLongTasks` are 0 in M0 and M1, and the assertions at lines 403-404 are tautologies. The plan's "no long task over 50 ms attributable to motion code" and "zero forced layouts from motion code" are not actually evaluated.
- Fix: either add an optional `categories` parameter to `startTraceCapture` (additive; default unchanged) to include `disabled-by-default-devtools.timeline.stack`, and read `args.beginData.stackTrace[].functionName/url`; and attribute each `RunTask` > 50 ms by time containment of its child `FunctionCall`/`TimerFire`/`FireAnimationFrame` events (`args.data.functionName/url`) on the main thread. If the bundle names do not survive, record the top three child events (name, functionName, url, dur) of every RunTask > 50 ms into the JSON so the orchestrator can attribute by hand, and set `attribution: 'unavailable'` instead of 0 so zeros are not read as "clean".
- Also `droppedFrames` (line 195) is filtered through `inMain`; `DroppedFrame` and `PipelineReporter` events come from the compositor/browser threads, so it is probably 0 by construction. Count them over all `events` (not only the renderer main thread). Check at M0: if every window shows 0 dropped frames while `layoutCount` is non-zero, suspect this.

### 7. S7 pointer test cannot detect swallowed clicks (lines 344-350, 396-398)

- Clicks use `el.evaluate(el => el.click())`, which dispatches directly on the element and bypasses hit-testing. A `::view-transition` overlay that intercepts pointer events (A2, the entire point of the S7 pointer scenario) is invisible to it, so `clickReceipt` always shows Analytics/Tasks, and the assertions at lines 396-398 are always true. The "tasks-button" is also clicked only `if (await button.count())` at that instant (line 349), so it silently skips when the lazy Tasks view has not mounted, then fails at M1 (line 398) for a timing reason.
- Fix: dispatch real pointer input without Playwright waits: read `getBoundingClientRect()` of the target in one `evaluate`, then `page.mouse.click(x, y)`. For the second target, wait for the element (bounded) before reading its rect, and record `reached: boolean` per target (listener fired for the intended element) in `outcome` per window instead of one cumulative counter. Use a specific safe button (add a test-id lookup or choose by role/name) rather than "first button in ptah-tasks-view", which may open a dialog and affect the later windows.

### 8. S7 `focus-restoration` focuses a non-focusable element, so the record is trivially BODY (line 360)

- `cards().first().focus()` targets the `li[data-rail-card]` host, which has no tabindex (canvas-rail-card.component.ts:57-70), so `focus()` is a silent no-op. The M0 and M1 records both say BODY and the M1 equality check (lines 391-395) proves nothing.
- Fix: focus `cards().first().locator('.rc-select')` (or `.rail-collapsed`), then `expect.poll`/assert that `document.activeElement` is inside the card before starting the window; assert the +0 sample's focus is not BODY so a bad precondition fails loudly.

### 9. S3 does not exercise non-retained opens after the first window (lines 305-308)

- Sessions alternate between index 4 and 0. After S2 the retained set is the four most recently focused. Opening session 4 evicts the least recent one (RailTranscriptRetentionCoordinator evicts the LRU frozen tree), but session 0 was among the recent four, so windows 2-5 swap between two retained sessions. The report's claim (non-retained windows 1-5) is wrong, and F-class evidence for rebuilding an evicted transcript is one data point.
- Fix: cycle in LRU order. With the S2 end state (MRU: s1, s0, s3, s2) use `[4, 2, 3, 0, 1]` (each target is the one just evicted), or compute dynamically. Add a precondition check on the number of mounted `ptah-chat-transcript` in the pane (should be 4) and record `retainedBefore: boolean` per window.

### 10. The test is picked up by every default e2e run and silently overwrites the M0 baseline (lines 27, 205)

- `testMatch: ['**/*.spec.ts']` (playwright.config.ts:21) includes `nav-session-motion.perf.spec.ts`; there is no skip gate, unlike the other perf spec (`PTAH_PERF_SPECS=1`, tile-open-longtask-budget.perf.spec.ts:166, 267), and `label` defaults to `m0` (line 27). Any `nx e2e ptah-electron-e2e` after B1-B6 would run a ~6-10 minute recording and overwrite `m0.json` with post-change data, destroying the baseline.
- Fix: `test.skip(!process.env['PTAH_MOTION_LABEL'], 'set PTAH_MOTION_LABEL=m0|m1 to record')` (no default label), and refuse to overwrite an existing `m0.json` unless `PTAH_MOTION_OVERWRITE=1`. Update the run commands in `reports/batch-B0.md`.

### 11. Timeout margin is thin for ~102 windows (line 206)

- Each window runs Tracing.start/Tracing.end (flush of a `devtools.timeline` capture), a PNG screencast session, probe install, a 610 ms wait and several round trips: realistically 2.5-4 s. 102 windows plus fixture setup and the populate loop is 5-8 minutes against `test.setTimeout(600_000)`. A slow machine hits the limit during S6/S7/S8, and the test then dies without writing JSON (item 4).
- Fix: `test.setTimeout(1_800_000)` and the incremental writes from item 4. Consider `format: 'jpeg', quality: 60` for the screencast (the PNGs are git-ignored via `.gitignore:141`, but full-size PNG encode every frame also perturbs the page being measured).

## Moderate and minor

- Lines 322-326 (`layoutShift` for every window must be 0): the plan limits this to rail and transcript. Page navigations legitimately shift layout (and programmatic clicks have `hadRecentInput=false`), so M1 can fail for non-motion reasons. Restrict to entries whose `sources[].node` is inside the rail or transcript, or compare against M0 per window.
- Line 406 (`reducedMotion` => `animations === 0`): `document.getAnimations()` includes unrelated infinite animations (pulse dots, spinners). Count only finite animations and record target/name lists (`a.effect.target`, `animationName`) so the M0 value is interpretable. The expectation also reads `at50`, which is pre-click (item 5).
- Lines 407-411 and 412: the entrance criteria are conditional on `animated.length` / pane count only, so if B4/B5 produce no entrance at all, S2-S4 and S8 pass. Add `expect(animated.length).toBeGreaterThan(0)` for S2-S4 windows with history, and assert a split-pane animation exists for S8 open (and none for the reduced S6 split windows); `firstVisibleDelayMs` is null when the first visible slot is not animated, which fails `toBe(0)` incorrectly.
- Missing M1 assertions from the plan: `focusSwapsDelta` equals the number of swaps (S2: 1 per window; S5: 5), "return to chat is not cut short" (F8) and the page-transition check uses `.some()` over only the canvas windows (line 414) instead of tasks/analytics/canvas windows. Use `expect.soft` so one run reports every failed criterion; the first failing hard `expect` currently hides the rest.
- Lines 389-390: if `m0.json` is missing, `readFileSync` throws a raw ENOENT after m1.json is written; when `label === 'm0'` it compares the run with itself. Guard with `existsSync`, fail with a message ("record M0 first"), and reject `PTAH_MOTION_ASSERT=1` with `label==='m0'`.
- Lines 218, 296, 314, 331: S2/S5/S6 use positional `cards().nth(i % 4)`, and after S3/S4 add four more cards the first four may not be the retained set. Capture the four `data-tab-id` values after the populate loop and click `[data-tab-id="..."]`.
- Lines 126-162: `sample()` calls `getComputedStyle` and `getBoundingClientRect` on every `.chat-msg-slot` at +0/+50/+100/+400, i.e. forced layouts inside the measured transition. This inflates `layoutCount`/`forcedLayouts` and can itself create a long task on 120-message transcripts. Take the placements sample once (at +50 ms) and only cheap fields at the other points. `entrance.placements` duplicates `samples.at50.placements` (JSON size).
- Line 161: `blank` can never be true on non-chat surfaces because `ptah-canvas-rail-board` stays mounted in the retained row; the field carries no information. Use visibility (`getClientRects().length`) of the board and the active surface host.
- Lines 207, 237-241: the frames folder is not cleaned, so stale PNGs from a previous run with the same label remain beside new ones. `rmSync(framesDir, { recursive: true, force: true })` first.
- Lines 340-341: non-null assertions on `__ptahMotionClicks!`; reuse the typed `w` from the guard. `any`/`ts-ignore`/`as unknown as` are absent, helpers are reused, and typecheck/lint were reported clean; line length and formatting are for the style reviewer.

## Answers to the five focus questions

1. M0 on base code: the run does not reach the end (items 1, 2). Selectors that only exist after B1-B6 are not used; the `--i` / animation reads degrade to null on base, which is correct. `PTAH_MOTION_ASSERT` gating is correct (assertions run only when it is `1`). Windows are non-empty for navigation scenarios but S2-S6 entrance/scroll samples read a hidden transcript (item 3).
2. Plan coverage: S1, S2, S4, S5, S6, S8 exist; S3 is mostly retained swaps (item 9); S7 click receipt is not measured by a real click (item 7) and focus restoration is trivial (item 8); entrance placement exists but is mis-anchored (items 3, 5). Memory counters are recorded; focusSwaps delta is recorded but not asserted.
3. Validity: observer installed before the action (OK, line 225 before 249); trace/screencast started and stopped per window (OK on the normal path); label validated; output path resolved from `__dirname` five levels up, which is the repo root (OK). Anchoring defect in item 5.
4. M1: assertions for long-task attribution and forced layouts are vacuous (item 6); missing-baseline handling is fragile (see moderate list).
5. Cleanup: the fixture closes the Electron app in `finally`, which also kills any leaked CDP sessions; no orphan process risk beyond that, but data loss on failure (item 4).
