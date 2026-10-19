# Implementation plan review r1 (Gate 2 re-review) - TASK_2026_700_dcce

Verdict: **APPROVED** (0 Blocking, 0 Serious, 3 Moderate, 5 Minor)

The revision closes every round-0 Serious finding. The three Moderate items below are gaps in test-gate
contracts. Without them a lane can fail its own gate on specs it does not own. The plan author or the
team-leader should fold them into `batches.md` before the lanes start. None of them changes the architecture.

Scope: `implementation-plan.md` (lines 1-166), `plan-revision-1.md`, `implementation-plan-review.md`,
`decisions.md` D1-D9, `design-spec.md`, `prototype/command-center.html`, and the code under
`libs/frontend/command-center/src/lib/`. This review read files only. No nx, jest or build command was run.

## 1. Round-0 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 Open tab and grid focus | N/A (D9) | A grep of the plan for `open tab`, `openChildTab`, `allowOpenTab`, `NOTIFICATION_FOCUS`, `focus router`, `live tab` and `tab availab` finds only negations (plan:5,42,145). There is no button, output, coordinator method, router, toast, test or availability text. |
| S2 Stats band width | RESOLVED | Page CSS owns the 1100/480 rules and one page `ResizeObserver` binds `[reservedTop]` (plan:64). The scene uses `reservedTop()+10` and `height-62`, and it does not infer the band from canvas width (plan:50). Contract row: plan:86. Spec tests set the input directly. The breakpoint is defined once. D1's clamp (midpoint, half-width and half-height axes, plate top at `y+6`, 8px edges) matches design-spec:63. See m1 and m2 for two edge clarifications. |
| S3 Resume last | RESOLVED | No `resumeLast` or `canResume` (plan:56). Start new calls `newCommandCenter()` (plan:64). This matches D7, and `newSession` exists at `command-session-controls.component.ts:82`. |
| M1 openChildTab failure | N/A (D9) | No coordinator change (plan:30). |
| M2 Child sphere grammar | RESOLVED | D2 adds a second silver ring for a live child, and a dimmed, dashed ring with a `CS` monogram for a persisted child, with renderer tests (plan:50). This matches prototype:130, which draws the child ring at `r+12` and dashes it when the child is `unknown`. |
| M3 A2 split and size | RESOLVED | A2a is mechanical and A2b does the wiring. Both are capped at 40 tool calls and are strictly sequential (plan:26,62,64). No other batch owns a page file (table at plan:28-38). The reference to the line-531 CSS read in the page spec is correct (`command-center-page.component.spec.ts:530-532`). |
| M4 DOM-selector contracts | PARTIAL | The six integration specs and their selectors are listed correctly (plan:66), and they match the actual `querySelector` calls. The page-spec selector list is incomplete, and C1 has no contract duty at all. See N1 and N2. |
| m1-m7, L1-L7 | RESOLVED | The m1 evidence was removed. Under D9, m2 and m3 no longer apply. m4: plan:7. m5: plan:64 (`ThemeService.toggleTheme()` exists at `core/.../theme.service.ts:373`, and the controller injects ThemeService as optional at `controller.ts:57`). m6: plan:109. m7: plan:48. The L items are tagged D8 or recorded as task choices. |

## 2. D4 coverage

| Item | Batch and test | Result |
| --- | --- | --- |
| M1: ring warning at >=70%, the same rule as the header | D3 tests 62, 70 and unknown; A1 header; A2b threshold test. One source: `contextWarning` at `page.component.ts:505-506`. | Covered |
| M3: Crucible plate at 900px | D1 `scene-layout.spec` non-overlap test (plan:48) | Covered |
| M4: tether | D1 coordinates; D2 renderer tether endpoint | Covered |
| M4: anchored owned-lane plate | D1 test | Covered |
| M4: child glyph on the plate | D3 test | Covered |
| M4: child glyph on the rail row | C2 implements it (plan:44), but C2's test list omits it | Gap (m3) |

## 3. Batches, parity, data and checks

- **File-disjoint:** yes (plan:28-38). A2a and A2b are the only batches that share files, and they are explicitly sequential. B, C and D do not touch page files. D3 depends only on D1's `labelRect` (`scene-layout.ts:24`).
- **Order:** the order holds. A2b runs after every other batch, and the `reservedTop` default of 72 keeps D2 green before A2b.
- **Size:** each batch is capped at 40 tool calls. A2b is the tightest. It covers wiring, four breakpoints, the observer, the controller method, and the page-spec rewrites in N2. See m4.
- **Parity:** all 39 rows are assigned (plan:101-139). Row 9's age bars are `remove-proposed, approved D1`.
- **Data honesty:** every displayed value has a real source:
  - elapsed time: `startedAt` (`store.ts:34`, `node-detail.ts:152`)
  - child stats: `childStats` (`page.ts:467`)
  - recent cards: `ChatSessionSummary` only
  - unknown cells are omitted
- **Commands:** the commands are memory-safe. Each is scoped to `command-center` with `--parallel=1` and `--maxWorkers=2`, and they run sequentially. The alpha-guard and jest config paths exist.

## 4. New findings

### Blocking
None.

### Serious
None.

### Moderate

**N1. C1 has no cross-spec DOM or text contract, but other owners' specs assert on its output.**
- These specs assert on `CommandNodeDetailComponent` text that C1 restyles:
  - page spec: `'7 messages'`, `'~12.3k tokens'`, `'~$0.01'`, escaped `'<b>Work</b>'`, and no `'0 messages'` (`command-center-page.component.spec.ts:245-284`)
  - overlay spec, owned by D3: `'Phase 1 / 1'`, `'Updated 3m ago'`, and no `'Provider: Unknown'` (`command-overlay.component.spec.ts:133-136,319`)
  - integration specs: `[aria-label="Selected work"]` contains the label, `agent` and `failed` (`delegation-and-status.spec.ts:151-156`, `accessibility-list.spec.ts:146`)
- C1's gate runs the whole project's tests, and "named specs belong to their source owner" (plan:26). So any change to that wording fails C1, and C1 has no file it is allowed to fix.
- Fix:
  - Add C1 to "Page DOM gates" (plan:66) and list these strings.
  - Either require C1 to preserve them, or state that C1 runs before D3 and A2b, and that D3 and A2b update their own specs for any intended wording change.

**N2. The page-spec selector list at plan:66 is incomplete, and one existing test contradicts the approved layout.**
- These page-spec selectors are not listed:
  - `header .badge:last-of-type` (context chip, spec:205,300,430)
  - `header button[title]` (voice chip, spec:614,648)
  - `.stage .left-5.top-5 p:nth-child(2)` (caption, spec:457)
  - `aside p[role="status"]` (write notice, spec:810)
  - `.alert` and `.alert button` (spec:714,737,745,945)
  - `.dock`, with a `.layout` parent, and the dock-before-rail DOM order (spec:681-686)
  - host classes `overflow-y-auto min-h-0` (spec:676)
  - `textarea, input` as the first field in the page (`failure-and-fallback.spec.ts:252`), so no input may precede the dock in DOM order
- The A1 header and the A2b band will move the badge order, the title buttons and the caption position.
- The test at spec:527-545 asserts the opposite of the approved layout: `.rail` is the single scroller and `.work-list-region` is `flex: none`. The new layout gives delegated work `flex:1; min-height:0` and puts the scroll in C2's card (plan:44,64).
- Fix:
  - List these selectors in plan:66.
  - Tell A2b explicitly to rewrite the spec:527-545 test to the new contract: the rail does not scroll and the delegated card is the only scroller.
  - Tell A1 to keep the header chip order and `title` usage, or hand the selector update to A2b.

**N3. A new `ResizeObserver` will throw in jsdom unless it is guarded.**
- jsdom provides no `ResizeObserver`. `scene/command-scene.component.spec.ts:51` stubs it, while the page spec and the integration harness do not.
- The scene creates its observer only after it obtains a canvas context (`command-scene.component.ts:325-331`), so it never runs in jsdom. The planned page band observer (A2b) and work-list observer (C2) are different. They render in all six integration specs, which must stay unmodified (plan:66).
- Fix:
  - Require `typeof ResizeObserver === 'undefined'` guards, following the precedent at `canvas-lane-tabs.component.ts:289` and `agent-lane-scroll.directive.ts:33`.
  - On the fallback path, `statsBandHeight` starts at 72 and the scroll cue is off.
  - Each component's own spec stubs the observer.

### Minor

- **m1.** The `reservedTop` semantics depend on the band overlaying the scene's measured stage box: the scene measures its own `stageRef` (`command-scene.component.ts:368-370`). State that the band is absolutely positioned inside that box, as the current caption is (`page.component.ts:322`). A band in normal flow would reserve the space twice. Also start `statsBandHeight` at 72 before the first measurement.
- **m2.** Boundary case: the plan uses 144px "at/below 1100" (plan:64), which matches prototype:43 `max-width:1100px`. design-spec:13 says 72px "at least 1100px". Record that the prototype rule wins at exactly 1100px.
- **m3.** Add the child `GitBranch` glyph to C2's tests (D4 M4 rail-row glyph). Add the dashed 70px child orbit to D2's renderer tests.
- **m4.** A2b has no test for the new controller `toggleTheme()` in `command-center-page.controller.spec.ts`. That file is not in A2b's file list. Add it. If A2b goes over 40 calls, move the page-spec rewrites from N2 into a sequential A2c.
- **m5.** Lanes share one worktree, and every gate runs `nx test command-center` over the whole project. Concurrent batches can therefore fail each other's gates on half-finished edits, and CLAUDE.md allows only one heavy check at a time across lanes. Say this in the plan so the team-leader serializes the checks, or assigns each parallel lane its own worktree.
