# Implementation Plan Review - TASK_2026_689_4d4f

Artifact: `implementation-plan.md` (145 lines). Method: document review; plan evidence spot-checked against `libs/frontend/command-center/src/lib/` (scene, overlay, page, controller, store). No checks were run.

## Verdict

- Verdict: **REVISE**
- Score: **6/10**
- Findings: 2 Blocking, 6 Serious, 6 Minor.

Strengths, with evidence: the plan is well grounded. The 23-node placement citations (`scene-layout.ts:71-114`), the overflow chip (`:406-423`), the `canvasUnavailable` locations (`scene.component.ts:103`, `page.component.ts:165,179`, `controller.ts:87`) and the seven voice states all match the code. Only the approved `canvasUnavailable` removal is listed (plan:125-126). There is no new dependency. Files are unique across batches A-F. Scoped, memory-safe commands are given (plan:110). The blockers and serious gaps below sit in the three mandated fixes, the preserve contract, and the inter-batch contracts.

## Blocking

### B1. M-R5 is geometrically unachievable with the plan's own placement rule (plan:81, 98, 135)

- The plan requires the plate (max 256px) to sit beside the active row, on a side that is "within stage" and keeps 4px clearance from the stream list, the dial and all cards (plan:81, 98). Reserve-below is "pinned-only last resort" (plan:98).
- At 1440 the stage is about 1056px (`design-spec.md` layout table). After 40px inset and 24px gaps, with the stream at 270px and the cards at 252px, the dial column is about 470px. The dial is 292px, so the free gap between the stream and the dial is about 89px. Even with the narrowest stream and cards (190px each), the gap is about 160px. Both are below 256 + 4px.
- The left side has no space because the stream sits at the stage's left inset. So both sides fail for nearly every row, and the plate falls into the reserve-below path. That is exactly the "plate ~500px from its row" defect the user asked to fix.
- The test specified at plan:98 ("1440 geometry expects right or left placement adjacent") would only pass with hand-picked rectangles.
- Required change:
  - Compute the real 1440 free-space budget in the plan.
  - Then choose a concrete near-row strategy. Options: allow the plate to overlay the decorative SVG and the dial column's empty region above or below the dial; allow it to overlay the dial's outer margin; or anchor it to the row's right edge and let it cover connectors only (connectors are decorative and `aria-hidden`).
  - Amend the avoid-list accordingly, because the design-spec "avoid dial and cards" rule is what makes this infeasible.
  - Define the maximum acceptable distance from the row, and state which reserve-below cases remain.
  - Add a test that uses the actual column arithmetic (stream 270, dial 292, cards 252, stage 1056) and asserts the placed rectangle is within N px of the row. Also assert that it overlaps no row text, card or dial.

### B2. Per-tribunal phase arc is silently re-homed to the single central dial (plan:41, 67)

- Today every tribunal node draws its own done/total arc (`command-scene-renderer.ts:390-403`). The design spec and prototype put this cue on the tribunal row (`design-spec.md:15` "scene row cue"; `prototype/index.html` `.tribunal-cue .arc`, about line 612 and 1222).
- The plan assigns it to `CommandCoreComponent`, which "takes ... tribunal progress" (singular, plan:41, 67). A session can hold several tribunals, and one dial cannot represent them. As written, per-tribunal progress is lost or aggregated. That is a dropped capability not listed under Proposed Removals.
- Required change:
  - Move the arc and cue into `CommandStreamsComponent` row rendering (plan:60), derived from the node's `phases`.
  - Remove "tribunal progress" from the core inputs, or define it as an explicit, separate aggregate.
  - Add a stream DOM spec for 2 tribunals with different done/total counts.
  - Fix the batch A and B acceptance text and the preserve row at plan:41.

## Serious

### S1. No pin/activate path from stream rows to the overlay (plan:60, 81, 43)

- The streams component emits only "selection, hover and focus-work-list" (plan:60). Today the overlay's `pin(id)` runs on click, Enter and Space, and calls `store.select`, `_pinnedNodeId.set` and `activate` (`command-overlay.component.ts:261-267`).
- With rows owned by streams, the overlay can learn about a pin only through a `selectedId` change. Re-clicking an already selected row, to reopen the plate after it was closed, produces no change. The overlay's own effect at `:181-184` also unpins when selection differs from `selectedBeforePin`, so pin and selection are coupled.
- Required change: add an explicit `activate`/`pin` output on streams, plus root and Escape key outputs. Specify who calls `store.select`, and how the `selectedBeforePin` guard survives. Add a test for re-activating the same row after close.

### S2. Row ARIA and key semantics from the old overlay buttons are not carried over (plan:42, 78-84)

- The old buttons carry `aria-label="label, state"`, `aria-pressed`, `aria-describedby` to the tooltip while hovering (not pinned), `aria-expanded` while pinned, and `(keydown.escape)` (`command-overlay.component.ts:42-60`). The plate switches between `role="tooltip"` and `role="region"` with a label (`:96-99`).
- The plan keeps only `aria-pressed` (plan:42). The relationships to the plate (describedby, expanded) and the Escape handling now live across two components and are unassigned.
- Required change: list these attributes in the preserve table. Assign them to `CommandStreamsComponent` rows, driven by overlay state (an input such as `activeId` and `pinnedId`). Add accessibility specs for describedby, expanded and Escape focus return.

### S3. Reservation rule is stated three inconsistent ways, with no stability guard (plan:81, 96, 98, 135)

- Plan:81 says "a pinned plate alone reserves plate height + 56px" (unconditional for pins).
- Plan:98 and 135 say reserve only when side placement fails.
- Plan:96 adds a generation token, but nothing prevents oscillation. Reserving space grows the stage, so a side may then fit, which releases the space, so the side no longer fits, and so on.
- Required change:
  - Pick one rule. User-mandated N2 requires only "reserve for pinned, release on close". Reserving only after a side failure is a valid refinement.
  - Define the decision as evaluated once per open/pin and per resize, with hysteresis.
  - Specify the channel from overlay (batch D) to the scene grid (batch E): for example a `reservedHeight` output or signal consumed by `command-scene.component.css`. The plan puts the reservation "in the scene CSS grid" (plan:81) but the overlay is a page sibling of the scene today (`page.component.ts:182-190`) and is owned by a different batch.

### S4. N2, M-R4 and M-R5 regression tests cannot work as written in JSDOM (plan:96-98, 143)

- Plan:96 requires a spec that "measures stage/dock before and after hover at 1440/1100/892". JSDOM has no layout, so heights are always 0.
- The risk note at plan:143 concedes geometry needs mocks, but the test text does not say what is asserted.
- Required change: define the seam.
  - Assert the overlay's `reservedHeight` signal or CSS variable is 0 after hover, and is non-zero only while pinned.
  - Assert it returns to 0 on each of the four close paths (button, Escape, outside click, selection change), plus on destroy.
  - Test the positioner and connector geometry as pure functions over supplied rects.
  - Move the real "dock does not shift" check to the Electron visual review checklist (plan:142), with explicit widths and both themes.

### S5. Parallel batches A-D have no interface contract (plan:60, 67, 74, 81, 117)

- Inputs and outputs of streams, core, status groups and connectors are prose only. Examples: `placed`, `selectedId` and `overflow` inputs are named, but the output names and types are not.
- The connectors "read scene/dial/visible rows/cards" (plan:74) with no stated DOM hooks, such as selectors or data attributes. Batch D's "agreed DOM row contract" (plan:117) is not defined anywhere in the plan.
- Ownership of the single observer conflicts. It is "in connector/scene" (plan:103), while the overlay must use "the one scene measurement schedule" (plan:81). The overlay is outside the scene and in a different batch.
- Lanes that cannot run checks will diverge on these names.
- Required change: add a short interface table (component, inputs with types, outputs with types, `data-*` hooks, the measurement-scheduler API) before the batches. Alternatively, add a batch 0 that creates only the types file and hooks.

### S6. Batch D cannot pass its own verification and cannot be committed alone (plan:117, 121)

- D removes the label-button layer, `visibleLabelIds`, `getOverlayLabels` and `getCardAnchor`, and changes the inputs. The page still binds `[visibleLabelIds]` and calls `scene.setOverlayLabels`/`setCardAnchor` (`page.component.ts:184,387,461,466`) until batch E.
- The team-leader flow verifies and commits per batch. A typecheck after D alone would fail, and the plan itself defers D's check until "dependencies land" (plan:121) while listing D as having none.
- Required change: make D a dependency of E (or merge D into E), or require D to keep temporary compatibility shims that F then removes. State the commit order explicitly.

## Minor

- M1. Plan:44 cites `command-overlay.component.ts:281-309,371-375` for an existing "outside click" path. The overlay has no document or pointerdown listener (only `document.activeElement` at `:302`). Outside-click closing is new behaviour, so cite it as new and spec the listener's lifecycle (attach on pin, remove on close and destroy).
- M2. `visibilitychange` pause (`command-scene.component.ts:279-283,327`) is not in the preserve table. CSS animation covers it mostly, but list it, or note that it is dropped as unnecessary.
- M3. Provider-specific sphere palettes (`paletteName`, `command-scene.component.ts:50-63`) and state glyphs such as the failed X mark (`renderer:385-388`) are replaced by marks and tokens (plan:49). Say explicitly that provider color identity and the non-color failed/awaiting cue are carried by the mark and the state text, and add them to the proposed-removals list for approval, or confirm they are covered.
- M4. Public scene APIs `setCardAnchor`/`setOverlayLabels` and overlay `getOverlayLabels`/`getCardAnchor` (`scene.component.ts:185-216`, `overlay:199-224`) are removed (plan:88). Add them to the removal list as an internal API for visibility, even though they are not product capabilities.
- M5. Reduced motion: the controller already tracks OS `prefers-reduced-motion` into `store.reducedMotion` (`page.controller.ts:298`; `store.ts:284`). The plan's extra `matchMedia` listener in the scene (plan:48) duplicates it. Use the store signal only.
- M6. The connector geometry for five layouts plus the observer and frame scheduler will likely exceed the lint file-size limit if kept in `command-connectors.component.ts`. Add a `connector-geometry.ts` (pure, spec'd) to the file list. Also, lanes A-C run no checks (plan:110), so type errors surface only when the orchestrator integrates. Order the integration so the orchestrator typechecks after each of A-C lands, not only after D/E.

## Check results by area

1. Preserve contract completeness:
   - Covered: projection, 23-cap and priority, overflow split, selection, 150/200ms hover, pin, Escape, keyboard and work-list focus, the seven voice states and clamps, running spin, reduced motion, theme feeds, and the six inputs plus the `selection`/`hoveredNodeId` outputs.
   - Missing or misplaced: the per-tribunal arc (B2), the pin path (S1), ARIA attributes (S2), `visibilitychange` (M2), the provider palette and state glyph (M3).
2. User-mandated fixes:
   - N2: the principle is designed (pinned-only, generation token, four close paths), but the rule is inconsistent (S3) and the test is not feasible (S4).
   - M-R4: designed for compact and stacked layouts (card-aware routing, pure geometry spec), which is the strongest of the three. Needs the geometry file split (M6).
   - M-R5: not feasible as specified (B1).
3. Only the `canvasUnavailable` removal is listed under approved removal (plan:125-126). The plan deletes no other product capability, but see B2, M3 and M4.
4. Batch hygiene: files are disjoint, and exact files, acceptance and memory-safe commands are given (no build/serve/e2e, `--parallel=1`, `--maxWorkers=2`, lanes run no Nx or Jest). Dependency order has the S6 problem. Interfaces are missing (S5).
5. Repo rules: standalone OnPush, `input()`/`output()`, signals and no `[innerHTML]` are stated (plan:6, 104). No new dependency. Animating only transform and opacity is stated for rotation and the voice ring (plan:67). Specs to add, update and delete are listed per batch. Specs for `command-center-page.controller.spec.ts` and the harness are in E. OK.
6. Feasibility: `store.reducedMotion`, `store.select`, `ProjectionResult`, `focusWorkListRow` and the `FloatingUIService` provider all exist. Contracts that do not exist yet and are not designed: the overlay-to-scene reservation channel (S3), the row activate output (S1) and the measurement scheduler API (S5).

## Required changes to reach APPROVED

1. Resolve B1 with a worked 1440 budget, a concrete near-row fallback, and a matching test.
2. Resolve B2 by moving the arc to stream rows.
3. Fix S1-S6 as described. The smallest set that unblocks implementation is the interface table (S5), the pin output and ARIA mapping (S1, S2), a single reservation rule with a channel (S3), a reworded test seam (S4), and the D/E ordering fix (S6).
4. Apply the Minor items, or record why not.

## Lane-introduced constraints

Rules in the plan that are neither user-requested nor existing project rules. All are `[lane-proposed]`, and the user has not seen them beyond the design gate. Items marked (gate) were visible in `design-spec.md`'s own lane-proposed list, which the user approved with fixes. The rest are new in the plan and need confirmation or removal.

- (gate) Container breakpoints 340/680/960px; dial 160/200/292px; visible rows 10/6/4/3; 96 ticks, a major tick every eighth (plan:7, 60, 67, 85).
- (gate) Four status cards in the order In progress, Waiting for you, Finished, Other work; core metric is active starting/running work (plan:67).
- (gate) 24px routing gutter, `plate height + 56px` reserve, 4px clearance, 256px max plate width (plan:74, 81).
- (gate) Row size 44px, 5px gaps, 7px viewport padding; root button at 68% of the dial; hide the inner voice caption at 160px (plan:60, 67).
- New: five new components (`CommandStreams`, `CommandCore`, `CommandStatusGroups`, `CommandConnectors`) plus the scene facade; `scene-placement.ts` as a pure module (plan:28).
- New: one scene-level `ResizeObserver` plus stream scroll/focus events coalesced to one animation frame; no per-row observer (plan:30, 74, 103).
- New: generation token to defeat stale frames or promises that reapply a reservation (plan:96).
- New: outside-click listener registered only while pinned and removed on close/destroy (plan:44, 81).
- New: the plate shows kind, provider, state, phases and available age (plan:81). The old plate shows only name, provider and state (`command-overlay.component.ts:104-114`), so confirm the extra content.
- New: no connectors below 340px (plan:74).
- New: status-group cards have zero tab stops and are non-interactive (plan:67).
- New: stream list is one roving tab stop with Up/Down scroll-into-view, replacing one tab stop per label button (plan:45).
- New: page copy change to "Select a work stream for status" (plan:85; also in `design-spec.md`).
- New: Nx flags `--output-style=static` in every batch command (plan:110). Not required by `CLAUDE.md`.
- New: the extra scene `matchMedia` listener for reduced motion (plan:48; see M5). It is redundant, so remove it rather than approve it.
- New: no count ticker and no animated filter/blur (plan:67, 74).

## Round 2

Scope: re-read `implementation-plan.md` (196 lines, `## Revision 1` at 177-196) against `prototype/index.html:177-241,312-322,536-548` and the current code (`command-overlay.component.ts`, `command-scene.component.ts`, `libs/frontend/command-center/src/index.ts`). No checks were run.

- Verdict: **REVISE**
- Score: **7/10**
- Open findings: 0 Blocking, 4 Serious, 3 Minor.

### Round 1 findings: closure check

| Finding | Status | Evidence |
| --- | --- | --- |
| B1 (M-R5 at 1440) | Closed in principle, one defect remains (R2-1) | The arithmetic is correct against the prototype grid (`index.html:180-190`). Stage 1056 = 1440 - 32 - 336 - 16. Columns are 270/470/252 with 20px padding and 12px gaps, so the dial leaves 12 + (470-292)/2 = 101px, and a 256px side plate cannot fit. The inline slot below the row (plan:84) is a sound fix. The 256px figure is 270 minus the list's 7px padding on each side (`index.html:225`). |
| B2 (per-tribunal arc) | Closed | Streams derive an arc and text per tribunal row (plan:61, 62). Core has no tribunal input (plan:67, 103). The test uses two tribunals with different counts (plan:62, 133). This matches the prototype's per-row `.tribunal-cue`. |
| S1 | Closed | `activate(id)` fires on a same-ID click. The page calls `store.select` then `overlay.activate` (plan:83, 109). The `selectedBeforePin` guard is kept. |
| S2 | Closed | ARIA hooks are assigned to rows (plan:102, 107). |
| S3 | Closed | One rule: preview never reserves, pin latches its mode, with 16px hysteresis and a generation token (plan:85). The decision is made from unreserved geometry. |
| S4 | Closed | Assertions are signals and attributes plus pure rectangle specs; the Electron check covers the rendered dock (plan:115-117, 125). |
| S5 | Closed | Interface table at plan:98-109. |
| S6 | Closed | D merges overlay, scene and page, and is checkable alone (plan:129, 136, 139). |
| M1-M6 | Closed | Plan:83, 49-51, 148-154, 75-78. |

### Open findings

#### Serious

- **R2-1. The 256px pinned plate has zero horizontal tolerance in a scrolling list (plan:84, 117).**
  - The slot is exactly 270 - 14 = 256px wide, inside `.stream-list { overflow:auto }` (`prototype/index.html:210-227`).
  - Whenever the list scrolls, a vertical scrollbar takes about 8-15px of the inner width. That happens with more than 10 placed rows (up to 23), and also with 10 rows plus the pinned slot. The plate is then wider than the content box and gets horizontal scroll or clipping.
  - Required change:
    - Set the plate width to `min(256px, 100%)` of the slot, or reserve `scrollbar-gutter` and size the slot from the measured client width.
    - Make the pure positioner spec cover a 241-248px inner width.
    - Remove the "exactly 256px" wording (plan:84).

- **R2-2. The floating hover preview traps the pointer over neighbouring rows (plan:85).**
  - The preview floats "immediately above or below its row" and may "cover neighboring row backgrounds/text". The old overlay keeps the preview open while the pointer is on the card or bridge (`command-overlay.component.ts:236-251`).
  - So the user moves down to the next row, lands on the preview, and keeps it open. The next row cannot be previewed or reached until the pointer leaves and the 200ms close timer runs.
  - Placing the preview over neighbours also contradicts `design-spec.md` ("avoid the stream list ... do not clamp an overlapping candidate").
  - Required change:
    - Make the preview non-interactive: `pointer-events:none`, tooltip role, and no card or bridge hover hold. Only a pinned plate is interactive.
    - Or place the preview in non-row space.
    - Add a test that hovering row N+1 while the preview of row N is open switches previews and does not hold the old one.
    - Add the preview-over-neighbours behaviour to the lane-introduced list so the user can accept it.

- **R2-3. Root activation has no plate anchor (plan:92, 103, 83).**
  - The core emits `activateRoot`, and the page then calls `overlay.activate(rootId)`. The overlay's only trigger is a stream row (`data-stream-row-id`, plan:83). The root has no row, and the old overlay did give the root a label button.
  - It is unspecified whether the root opens a plate, anchors to the dial, or only selects.
  - Required change: state the behaviour. For example, the root selects only and opens no plate, or the plate anchors to `data-core-dial` with reserve-below. Then add an overlay spec for it and name the removal of any root plate explicitly in Proposed Removals if it is dropped.

- **R2-4. "A-C can proceed without the removal answer" is only partly true (plan:148, 152-153, 175).**
  - Proposals 1 (provider sphere palette) and 2 (failed/awaiting glyph artwork) are implemented in stream rows, which batch A builds (plan:133). If the user declines, A must be reworked, not just D.
  - Batches B and C are independent of all three answers. Proposal 3 only affects D.
  - Required change: either change the sequencing so the answer on proposals 1-2 comes before A lands, or have A expose the hooks (provider-color custom properties, a state-glyph slot) so a decline is purely additive. Reword plan:148 and plan:175 to match.

#### Minor

- **R2-5. Inline-slot fit rule is contradictory (plan:85).** The plate is "capped to fit the viewport", yet the reserve fallback applies "if the viewport is too short". With a cap the fit test never fails. Define a minimum usable plate height (for example 120px) below which the reserve path is chosen. At 4 rows the viewport is 4x44 + 3x5 + 14 = 205px, which leaves about 139px after the row and gap, close to that threshold. At 3 rows it is 161px, so it fails.
- **R2-6. Proposal 3 is partly answerable from evidence (plan:154).** `libs/frontend/command-center/src/index.ts` exports only `CommandCenterPageComponent`. `setCardAnchor`, `setOverlayLabels`, `getOverlayLabels` and `getCardAnchor` have no external consumers. State that, and the question to the user becomes trivial or can be settled as a recorded decision.
- **R2-7. Batch D is very large (plan:136).** It has 17 files (scene rewrite, overlay, positioner, page, controller, harness and specs). That is acceptable for atomicity, but the file-size and lint risk is high. Require the orchestrator to run the scoped lint before the Jest run, and allow splitting `command-center-page.component.ts` template parts into the scene component, as plan:173 already suggests.

### Proposed Removals: listing check

The three items (palette, glyph artwork, anchoring API) are listed correctly at plan:150-154, each with evidence, consequence, a recommendation and reversibility. They are correctly kept separate from the approved `canvasUnavailable` removal (plan:143-144). Only R2-4 and R2-6 above apply.

### Lane-introduced constraints (additions in Revision 1)

- Pinned wide-layout inline slot below the active row, and the 16px hysteresis threshold (plan:84-85).
- Floating hover preview overlay that may cover neighbouring rows (plan:85); see R2-2.
- Plate `max-height` with internal scroll (plan:83).
- `SceneGeometry` snapshot, `PlateReservation` and the page-bridged reservation channel (plan:98-109).
- A separate `scene-measurement.ts` scheduler module (plan:136).
- Scene facade emits both `selection` and `activate`; the page binds only `activate` (plan:106).
- Proposals 1-3 in `## Proposed Removals` are awaiting the user.

## Round 3 (final)

Scope: plan now 218 lines (`## Revision 2` at 204). Checked against `prototype/index.html`, `context.md` section "Plan removals gate", `libs/frontend/command-center/{project.json,jest.config.ts,src/test-setup.ts,src/index.ts}`, `integration/integration-harness.testing.ts`, `eslint.config.mjs`, `libs/frontend/canvas/.../agent-dock-card.component.ts`, `node_modules/lucide-angular`. No checks were run.

- Verdict: **REVISE** (one narrow fix, details in R3-1)
- Score: **8/10**
- Open findings: 0 Blocking, 1 Serious, 4 Minor.

### Round 2 findings: closure check

| Finding | Status | Evidence |
| --- | --- | --- |
| R2-1 (256px plate in a scrolling list) | Closed | Plate is `width:min(256px,100%)` of a content box taken from `clientWidth` minus padding, so the scrollbar is excluded (plan:84, 99, 103). The 1440 figures are correct (270-14-15 = 241; 270-14-8 = 248). The compact-width numbers need a small correction (R3-2). |
| R2-2 (preview traps the pointer) | Closed | Preview is `pointer-events:none`, outside the list, never held by plate or bridge, and row N+1 switches it (plan:85-86, 88). The 1440 side gap is 12 + (470-292)/2 = 101px, which leaves 93px after 4px clearance on both edges, as the plan states. See R3-3 for stacked layouts. |
| R2-3 (root plate anchor) | Closed | `data-core-root-id`, root hover/activate/Escape outputs, below-dial pin, heading fallback, and separate overlay tests (plan:71, 83, 85, 104, 108). One placement ambiguity remains (R3-5). |
| R2-4 (A not independent of removals) | Closed | All four decisions are recorded in `context.md` and plan:144-155, and no proposals remain open (plan:155). |
| R2-5 (fit rule) | Closed | One rule: at least 120px available, capped with internal scroll. The arithmetic is right: the 4-row viewport is 205-44-8 = 153px, and the 3-row viewport is 161-44-8 = 109px, which falls under the threshold (plan:85). |
| R2-6 (anchoring API) | Closed | `src/index.ts` exports only `CommandCenterPageComponent`, so there are no external consumers. The removal is approved and D2 removes methods and callers together (plan:151). |
| R2-7 (batch D size) | Closed in intent, but the split introduced R3-1 | D1/D2/D3 are file-disjoint and each file appears once. |

### Lucide import check

- `lucide-angular@^1.0.0` is a root dependency (`package.json:184`), installed at 1.0.0.
- The `command-center` project's tags are `scope:webview`, `type:feature`, `platform:angular` (`libs/frontend/command-center/project.json`). `eslint.config.mjs` has no `bannedExternalImports` or `allowedExternalImports` entry. `@nx/enforce-module-boundaries` only constrains workspace-internal dependencies, so an npm package import is not a boundary violation.
- The import form matches `libs/frontend/canvas/.../agent-dock-card.component.ts:13` (`LucideAngularModule` plus named icons from `lucide-angular`), and other libs use it too (`chat`, `notification-center`).
- All six icons resolve. `CircleCheck`, `CircleX`, `Ban`, `LoaderCircle` and `CircleDashed` have their own `icons/*.d.ts`. `MessageCircleQuestion` is an alias of `MessageCircleQuestionMark` in 1.0.0 and is already imported at `libs/frontend/notification-center/src/lib/notification-center.component.ts:14`, so it compiles.
- `command-center/jest.config.ts` has the same Jest setup as `canvas/jest.config.ts` (the `transformIgnorePatterns` regex is spelled differently but equivalent), so the icons render in specs.
- The six-icon mapping covers all nine `CommandWorkState` values (`command-center.store.ts:15-24`).
- Conclusion: allowed and consistent with the canvas usage.

### Open findings

#### Serious

- **R3-1. Batch D2 cannot pass the full suite, because the harness stub moves to D3 (plan:138-139, 142).**
  - D2 changes the page template to bind new scene inputs and outputs (`activeId`, `pinnedId`, `plateReservation`, `reducedMotion`, `activate`, `escape` and so on, plan:93, 107) and to bind only `activate` for the store update.
  - The integration specs render the page against `SceneStubComponent` (`integration/integration-harness.testing.ts:23-37`). It has only the old inputs and outputs (`selection`, `hoveredNodeId`, `canvasUnavailable`). `test-setup.ts` sets `errorOnUnknownProperties: true`, so the integration specs that use the harness (`delegation-and-status`, `session-identity-and-lock`, `tribunal-confirm-gate`, `voice-turn-loop`, plus the two D2 edits) fail in D2. Any test that emits `stub.selection` also no longer reaches `store.select`. The file is only assigned to D3 (plan:139).
  - Required change: assign `integration/integration-harness.testing.ts` to D2. Update the stub with the new inputs and outputs and remove its `canvasUnavailable` there. D3 then keeps only `command-center-page.controller.ts` and its spec (the unused signal). Also re-check that the other integration specs which use the harness need no D2 edits beyond the two already listed (plan:138). Update the "D2 keeps ... harness fixture briefly" sentence (plan:142) to say only the controller signal is deferred.

#### Minor

- **R3-2. Compact-width arithmetic uses the wrong stage inset (plan:84, 88, 137).**
  - The 340-679 band uses a 16px inset (`design-spec.md` layout table), not 20px. The plan computes `400 - 40 - 24 - 14 - 15 = 307` and `340 -> 247`.
  - With the correct 16px inset: `400 - 32 - 24 - 14 - 15 = 315` and `340 - 32 - 24 - 14 - 15 = 255`. The 680-959 band, which does use 20px, gives different numbers again.
  - Required change: fix the numbers and the spec cases in plan:84, 88 and 137. Also state the stacked-layout behaviour for the range where the plate falls under 256px.
- **R3-3. The hover preview is effectively absent in stacked layouts (plan:85-86).**
  - There the only safe non-row space is the 24px gutter and the stage padding above the list, both under the 92px minimum, so the preview is suppressed.
  - This is acceptable because rows already show name, provider, state and age. State it explicitly so it is not read as a defect, and add a pure placement test that expects suppression at 1100, 892 and 400px.
- **R3-4. Running indicator rotation period (plan:64, 150).** The spinning `LoaderCircle` replaces the old running arc. Say it keeps the preserved ~3.7s/revolution (`design-spec.md` Running state row) and animates `transform` only.
- **R3-5. Root pin placement in the wide layout is ambiguous (plan:85).** "Directly below the dial" and "immediately after streams" describe different places in the three-column grid. Specify one: a grid row below the three columns, with the plate aligned to the dial column's centre. Also confirm that this pinned-only growth releases on every close path, as the stream pin does.

### Other checks that came out clean

- Plan:130-140: dependency order is A/B/C, then D1, D2, D3, E. A, B and C are file-disjoint, run no Nx/Jest in parallel, and use the repo's memory-safe commands. The only batch defect is R3-1.
- Repo rules: standalone OnPush, `input()`/`output()`, signals, no `[innerHTML]` (plan:123), no new dependency (lucide-angular is existing), only `transform`/`opacity` animation, and no new library export.
- Approved changes (plan:144-151) match the user's recorded decisions. ngxui is not used (local SVG/CSS), consistent with the plan.

### Lane-introduced constraints (additions in Revision 2)

- 120px minimum for an inline plate, the 16px threshold hysteresis, and the 93px compact hover preview with its 92px suppression floor (plan:85-86).
- Root pin always reserves scene height (plan:85).
- `data-scene-heading` as programmatic focus fallback for the root (plan:83).
- D1/D2/D3 batch split and `components/command-overlay-placement.ts` as a new pure module (plan:137-139).

## Round 3 confirmation

- Verdict: **APPROVED** (one Minor wording defect, no blocker; fix while implementing).
- Scope: only the Revision 3 edits (plan:221-233) and the two corrected line refs. No checks were run.

| Item | Result | Evidence |
| --- | --- | --- |
| R3-1 harness into D2 | Confirmed | plan:139 lists `integration/integration-harness.testing.ts` under D2 with the `errorOnUnknownProperties: true` reason; plan:140 (D3) is controller.ts plus its spec only; plan:95 and plan:143 say D2 drops the harness mock and only the controller signal is deferred. The file appears in one batch. |
| R3-2 stacked widths | Confirmed | 400-32-24-14-15 = 315 and 340-32-24-14-15 = 255, at plan:84, 89, 119, 138, 211. |
| R3-3 stacked suppression | Confirmed with a Minor wording defect (R3c-1) | plan:86 adds the always-suppressed rule with a pure placement spec and a DOM spec. |
| R3-4 loader period | Confirmed | plan:151 (~3.7s per revolution, transform only, frozen under reduced motion). |
| R3-5 root pin | Confirmed | plan:85 puts the root pin below the dial in every layout, with the after-streams reserve for stream pins only. |
| Line refs | Confirmed | `command-center-page.controller.ts:237-245` is the `projectOwnedWork` call (the statement closes at 246); `prototype/index.html:311-320` covers `.core` and `.dial`. |

### Remaining defect

- **R3c-1 (Minor). plan:86 says "Stacked layouts (container < 680px)".** The stacked arrangement also covers 680-959px (`design-spec.md` layout table), where no safe non-row rectangle exists either (24px gutter, 20px padding above the list). Change the condition to "< 960px" and add 1100-window (716px stage) to the specs. The generic suppression rule at plan:85 and 87 should already suppress there, so this is an inconsistency in the wording, not a behavioural gap.
- Stale history, no action: Revision 2 rows at plan:217 and 219 still describe D3 as "controller/harness cleanup". Revision 3 supersedes them.
