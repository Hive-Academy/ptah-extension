# Code Logic Re-review - R9u fix round (TASK_2026_629_c0b3)

Reviewer: Claude code-logic-reviewer. Implementer: codex lane. State: uncommitted, 6 chat source/spec files.
Scope: only the fixes for S1, S2, M1, M2, M3 of `code-logic-review-R9u.md` plus regressions. Files read in full where they carry the fix:
coordinator service + spec, `transcript-retention.service.ts`, `chat-view.component.ts` (token, `shouldOverlayDock`, `isOverlay`,
`dockWidth`/`dockMaxWidth`, key handler, `transcriptTabIds`), `chat-view.component.html` (separator attrs, `data-tab-id`),
`chat-view.keepalive.spec.ts:307-522` (harness and new cases), lane report, decisions row 100, contract `batches-rail-r9.md:498-505`.

Runs by me (one at a time, scoped, through the lock, logs in %TEMP%):

| Run | Result |
| --- | --- |
| `chat-view.keepalive.spec.ts` (rr-r9u-1) | 9/9 pass; 8 NG0101 lines |
| same file, `--testNamePattern="workspace-switch transcript survival"` (rr-r9u-2, only the 2 pre-existing cases) | 2 pass, 7 skipped; **8 NG0101 lines, identical count** |
| `rail-transcript-retention-coordinator.service.spec.ts` (rr-r9u-3) | 6/6 pass |
| `chat-view.dock.spec.ts` (rr-r9u-4, R9h decision-89 dock cases) | 26/26 pass |

Not run: typecheck, lint, full suite. "Fails if the fix is removed" below is by code-path reasoning, not by mutation (I may not edit source
or change git state). Each such claim names the exact line whose removal breaks the assertion.

## Verdict

**APPROVE (score 8/10, confidence MEDIUM-HIGH).** All five findings are fixed. One new Moderate (late host registration is not reactive,
reasoned, not executed) and three Minors. Nothing blocks the commit; the Moderate should be recorded for R9w (split creation is where it can
occur).

Band: 8 rather than 9 because the S2 reactive filter has one untracked dependency (the host registry map) and the DOM assertions in the
two-pane test run after `TestBed.tick()`, so the strong proof is the synchronous `transcriptTabIds()` assertion, not the DOM count.
Not 7 because every original finding now has a component-level test that fails on removal of the fixed line.

## Per-finding table

| Finding | Status | Evidence (file:line) | Fails if fix removed? |
| --- | --- | --- | --- |
| S1 dock-mounted case + token wiring | **FIXED** | `mountRail` (keepalive.spec:336-572) mounts a real `ChatViewComponent` with `SESSION_CONTEXT`, `RAIL_TRANSCRIPT_RETENTION: true`, the shared `RailTranscriptRetentionCoordinator` (spec:528) and `RAIL_MIN_CONTENT_WIDTH = signal(360)` (spec:527); host width is driven through the real ResizeObserver callback (`emitHostWidth`, spec:561-570). No `HIDE_AGENT_SIDEBAR` provider (grep: only `conductor-tile.component.ts:221` provides it). Component-side: token inject `chat-view.component.ts:276`, formula `:108-117` via `isOverlay` `:442-449`. | Yes, see below |
| S2 reactive "live in other pane" exclusion | **FIXED** (one residual, N1) | `liveElsewhere` coordinator:26-31 reads each other host's active signal; service passthrough `transcript-retention.service.ts:63-65`; used inside the `transcriptTabIds` computed `chat-view.component.ts:867-870`. The computed tracks the other pane's signal, so it is reactive, not effect-ordered. | Yes (computed assertions) |
| M1 dock max cannot reach the flip | **FIXED** | `chat-view.component.ts:484-492` (cap `host - token`, floor `DOCK_MIN_WIDTH` 300), `:476-483` (custom width capped by it). `End` at 804 gives `aria-valuenow` 444 and no `absolute` class (spec:476-484). | Yes |
| M2 destroy wiring asserted | **FIXED** | coordinator.spec:117-128 destroys `hostInjectors[0]` then `coordinatorInjector` and asserts `clearForTab` for A, B, C and `distinctRetainedCount` 1 then 0. | Yes, both halves |
| M3 split, exact contract names | **FIXED** (small residue, M-a) | coordinator.spec:91-98 `cache cleared only at last owner, not on transfer`; `:100-105` `close release`; `:107-115` `workspace release` (initial effect flushed at `:110`, then Z touched, so effect 1 does not re-run). | Yes (workspace case isolated) |

### S1 detail

- `760/759 px flips with the default 400 px dock` (spec:449-456): with the token inject dropped or the third term of `shouldOverlayDock`
  removed, 759 px is side mode (759 >= 600) and `separator()` is not null, so the case fails. It also pins `aria-valuenow` 400.
- `side dock at 804 / overlay at 644` (spec:428-437) and `976 / 648` (spec:439-447): 644 and 648 are above the old 600 px breakpoint, so
  they are side mode without the token wiring and the `separator()).toBeNull()` assertions fail. These go through the component, not a helper.
- `token absent -> old breakpoint` (spec:458-465): `provideMinimum: false`, side at 644, overlay at 599. Fails if the optional inject
  defaults to a number, or the null path is not the 600 px rule.
- `Rail ChatView with coordinator keeps the display dock mounted` (spec:467-474): asserts `dock()` and `toggle()` exist. Fails if the dock
  branch (`chat-view.component.html` display dock `@if`) is removed or `HIDE_AGENT_SIDEBAR: true` enters the harness. It cannot detect a
  Rail host elsewhere providing the flag (the ChatView has no way to know); the canvas side already guards that
  (`canvas-detail-transcript.component.spec.ts:122,174`). The `coordinator toBeDefined()` line is trivially true (it is provided at module
  level) but harmless.
- Residual (Minor): the "(1280 stacked)" and "(920 stacked)" in the titles are labels only; the widths 976/648 are the pane widths. Same as
  the original contract wording.

### S2 detail

- Reactive: `transcriptTabIds` (`:852-883`) calls `this._retention.liveElsewhere(id)` for every retained id. Reading
  `activeTabId()` of the other hosts inside a `computed` makes the exclusion depend on those signals; no effect ordering and no tree order
  is involved any more.
- Two-ChatView test (spec:486-521) uses the shared TestBed-level coordinator, a second ChatView in `OtherRailPaneComponent` with its own
  `SESSION_CONTEXT` (`otherPaneTab`, spec:307-320), and swaps both ways (tab-1 to tab-2 in pane A then back). `countX` is the sum of
  `ptah-chat-transcript[data-tab-id="tab-1"]` in both panes, asserted `1` after the first `detectChanges` of each fixture (spec:497-503)
  at the start and after each swap. The direct `transcriptTabIds()` assertions (spec:508-509 pane A after direction 1, spec:513-516
  pane B after direction 2) run with no `tick`, i.e. synchronously after the signal writes.
- Fails if removed: without `liveElsewhere` (`:869`), pane A's list is `['tab-1', 'tab-2']` (retained tab-1 plus appended active) right
  after `otherPaneTab.set('tab-1')`, so `not.toContain('tab-1')` fails in direction 1; the mirror holds for pane B in direction 2.
  Caveat: `detectBoth` calls `TestBed.tick()` first (spec:498), which already runs effects, so the DOM count alone would catch the old
  defect only if the effect-ordered release were also gone. The synchronous computed assertions are what make the test fail on removal.
- NG0101: see "NG0101" section; the new cases and the new computed do not cause or worsen it.

### M1 detail

- With the token set: max = `max(300, min(round(0.75 * host), host - token))`. At 804/360 the max is 444, so the stored wide width
  cannot make `host - dock < 360`; `isOverlay` cannot flip by drag, `ArrowLeft`, or `End`. Keys read `dockWidth()` (`:619`) which is the
  capped value, so `ArrowRight` after `End` responds at once (444 to 428, no dead key presses). `aria-valuemax` follows `dockMaxWidth`
  (`html:278`).
- Floor 300 kept (`:491`). It cannot reach the flip while the separator exists: when `host - 300 < 360` (host < 660), the default 400 dock
  already puts the pane in overlay unless a custom width was stored earlier, and the cap equals 300 there.
- No change when the token is absent: `dockMaxWidth` is the old `round(host * 0.75)`, and the custom branch is
  `min(clampDockWidth(custom, host), round(host * 0.75))`, with `clampDockWidth` (`:1943-1945`) clamping to the same 0.75 bound, so the
  extra `min` is a no-op. `host <= 0` returns `null` and `?? Infinity` leaves the width alone. `custom === null` skips the cap, so the
  default 400 px width and the 760/759 boundary are unchanged (spec:449-456 asserts `aria-valuenow` 400 at 760). The R9h dock spec
  passes 26/26 (rr-r9u-4).
- No new reactive cycle: `dockWidth` reads `customWidth`, `hostWidth`, `dockMaxWidth`; none reads `isOverlay`.
- Fails if removed: without the cap `End` sets 603 (service clamp to 75%), 804 - 603 = 201 < 360, the dock goes overlay and the
  `separator` leaves the DOM, so both `aria-valuenow` 444 and the `absolute` assertions fail.

### M2 / M3 detail

- M2: removing the host `onDestroy` (`service:80-85`) leaves A and B uncleared, failing the first two `clearForTab` expectations and the
  count of 1. Removing the coordinator `onDestroy` (coordinator:15-19) leaves C uncleared and the count at 1, failing the last two.
  Teardown order is as in production (host first, then board); `releaseHost` is idempotent, so `afterEach` destroying the rest is safe.
- M3: the three cases are separate `it` blocks with the exact contract names. In `workspace release`, `TestBed.tick()` at `:110` flushes
  effect 1 before Z is retained; the second tick re-runs only the removed-workspace effect (effect 1 does not track `retainedTabIds`, it
  is `untracked`), so deleting `service:117-123` fails the case. `close release` goes through the `onTabClosed` listener, so removing
  `service:105-110` fails it.

## Regressions

| Check | Result |
| --- | --- |
| No-coordinator path unchanged (R9h behaviour) | OK. `_coordinator` is `null` unless the Rail flag is true and a coordinator is provided (`service:43-45`). `touch` without it is the old body (`retainFromCoordinator` + `evictOverCap`, `service:136-137`); `dispose` is `releaseFromCoordinator(tabId)` with `preserveCache=false` (`:162`); host destroy loops `dispose` as before (`:83`); `liveElsewhere` returns `false` (`:64`) so `transcriptTabIds` filters nothing extra. `transcript-retention.service.spec.ts` 19/19 per lane (not re-run by me). |
| `HIDE_AGENT_SIDEBAR` absent for Rail | OK. Only `conductor-tile.component.ts:221` provides it; none in the fix files. |
| Coordinator imports no canvas | OK. Imports are `@angular/core` and a type-only import of the retention service. No cycle (service imports the coordinator value for DI, the coordinator imports the service as `import type`). |
| Public API | `index.ts` adds only `RAIL_MIN_CONTENT_WIDTH` and `RailTranscriptRetentionCoordinator`. |
| Template | Only `[attr.data-tab-id]` added (`html:82`); no behavioural change. |
| R9h dock cases | `chat-view.dock.spec.ts` 26/26 pass (my run rr-r9u-4). |

## NG0101

The 2 pre-existing cases alone (`workspace-switch transcript survival`) print 8 `NG0101: ApplicationRef.tick is called recursively`
lines; the whole file with all 9 cases also prints 8. So the 7 new cases add 0. Those pre-existing cases mount no coordinator, so
`liveElsewhere` returns `false` there and cannot be the cause. The new computed is read-only (reads signals and a `Map`, writes
nothing); the pre-existing recursion comes from the existing fixture harness. I could not compare with HEAD without changing git state,
so I cannot say the 8 is the same number as before the batch. The evidence is that the new code paths neither add nor change the count.

## New defects

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| N1 | Moderate | coordinator:21-23, 26-31 | The host registry `active` is a plain `Map`, not a signal. `liveElsewhere` only tracks signals of hosts registered when the computed last ran. If pane B is created later (split, `@for` panes) while tab X is already frozen in pane A, and B's active tab is X, pane A's cached `transcriptTabIds` does not know about B, so A keeps rendering frozen X while B appends live X. The dup lasts until B's activeTabId effect runs `touch`, which makes A release X and A's computed then recompute and track B (the original S2 symptom, now narrowed to late registration). Reasoned from the code; I did not run it. The two-pane test cannot see it: pane B starts on `tab-2`, which is not frozen in A. Fix: back the registry with a signal (e.g. a `signal<ReadonlyMap>` or version counter read in `liveElsewhere`), and add a test that mounts the second pane on a tab frozen in the first. Record for R9w. |
| N2 | Minor | coordinator.spec:78 | The contract lists "count <= 4 counts distinct tab trees" and "fifth distinct tab evicts..." as separate cases; they are still one `it`. This was already noted in the first review table, not part of M3. |
| N3 | Minor | `chat-view.component.ts:491` | With the token set, `Math.max(DOCK_MIN_WIDTH, ...)` can make `dockMaxWidth` 300 > 75% of host when host < 400. Overlay-only widths with no separator, so no user-visible effect; `aria-valuemax` would be off in that state. |
| N4 | Minor | `chat-view.component.ts:617-646` | `storeDockWidth` persists `customWidth()` (service-clamped at 75%), not the capped visible width. After `End` at 804 the stored width is 603 and the dock jumps to 603 when the pane is widened. It reads as "End = widest" and is not a bug; recorded only as a visible-vs-stored mismatch. |

The three original Minors (unregistered host without `SESSION_CONTEXT`, soft cap with more than two hosts, no dev assertion for
the same tab in both panes) are unchanged and are logged in decisions row 100 for R9w/PR.

## Five logic questions (fix round only)

1. **Silent failure.** The old vacuous dock case is gone; the replacement fails on dock removal. Late host registration silently keeps a
   stale exclusion (N1).
2. **Unexpected user action.** `End`/drag/arrow past the content minimum no longer flips the dock to overlay (M1). Opening in a new
   pane a tab frozen in another pane is the N1 window.
3. **Wrong answer on input.** Token absent, null, or `hostWidth === 0` give the old results (`shouldOverlayDock:114`). A non-finite token
   degrades to the old rule.
4. **Dependency failure.** Coordinator destroyed before hosts, or hosts before the coordinator: both paths release owners exactly once
   (M2 test, idempotent `releaseHost`).
5. **Missing though unstated.** A reactive registry (N1); a dev-mode guard for the same tab live in two panes (unchanged Minor).

## Verdict

- Recommendation: APPROVE (commit R9u as is; carry N1 to R9w/PR).
- Confidence: MEDIUM-HIGH. Mutation claims are by reasoning; the three scoped specs and the dock spec ran green.
- Top risk: N1, a one-tick duplicate X transcript when a second pane is created on a tab already frozen in the first.
- What a robust implementation would add: a signal-backed host registry in the coordinator and a late-registration two-pane case;
  split the "count <= 4" and "fifth evicts" cases; a dev-mode assertion for one tab live in two panes.
