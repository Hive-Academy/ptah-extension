# Code Logic Review, Batch 3 (Inline blocks), TASK_2026_690_a5c0

Review family: Claude reviewer, codex implementer.

Score: 6/10. Verdict: REVISE (core behaviour is right; duplicate-id and test-coverage gaps).

Scope: ptah-ui-message-text, ptah-ui-block, ptah-ui-display-chip components and the new ptah-ui-inline-display spec, read in full. Specs were not run (orchestrator runs the project checks); findings are from source reading.

## Blocking
None.

## Serious

### S1. Duplicate DOM ids when one display id appears in several fences
- File: `ptah-ui-block.component.ts:279-284` (surfaceId = displayId), used at `:228` (`[id]="reasonId()"`) and in `aria-describedby`.
- Scenario: the normal case for `display [id]`: an agent updates `display release` over several turns. Every historical inline block now has surfaceId `release`, so `release-reason` (and any id derived from surfaceId inside the renderer/text alternative) is repeated in one document. `aria-describedby` then resolves to the first match, so an invalid block's reason can be announced against the wrong block.
- Also unverified: whether `ptah-surface-renderer` or the pipeline keys any view/selection state by surfaceId. Inline edits must stay local (plan section 3, failure/seam) and must not alias the sheet or a sibling historical block; no test proves it.
- Fix: keep the display id only for compilation (`pipeline.compile(body, surfaceId)`), and derive DOM ids from the unique fence identity (`blockSurfaceId(nodeId, ordinal)`), e.g. `reasonId` from that. Add a spec with two fences sharing an id asserting unique `id` attributes.

## Moderate

- M1. Drift risk between inline and collection validation. The block re-implements the reserved-id check with a literal (`ptah-ui-block.component.ts:290-292`, `'reserved display id'`) while the headless sync owns `RESERVED_REASON` and `compileFence` (`display-surfaces.ts:109,191-209`). Same text today, but any later rule added to `compileFence` makes the inline block render content the collection marks invalid (chip then says "Not in display" beside a fully rendered block). Export and reuse the shared check or `compileFence` instead of copying.
- M2. Test gaps against the plan's required matrix (plan section 3 failure/seam): no same-id update case, no `pending` (null status with dock present) case, no dock-reported `invalid` case, no assertion that the action is hidden for `evicted`/`invalid`, no "Open latest" label assertion for `superseded`, and the VS Code case (`ptah-ui-inline-display.component.spec.ts:77-82`) only asserts the text, not that no action button exists. Inline-edits-stay-local is not tested.
- M3. The "superseded"/"evicted" tests (`:84-92`) set status after render, which proves the renderer node survives; they do not prove a freshly mounted historical block renders when it is already superseded at first paint (remount after `PtahUiLiveWindow` eviction freezes to a snapshot, `ptah-ui-block.component.ts:440-446`). Add that case.
- M4. Chip is rendered after every display block even when the host has no dock (shows "Display panel unavailable" text on every display fence in VS Code). It is accurate, but a persistent line under every block is noisy; consider hiding it when `!available()` or making it a subdued note once per message.

## Minor

- `ptah-ui-display-chip.component.ts` (new file) and the inline spec are not prettier-formatted (long one-line import/template, `ptah-ui-block.component.ts:282` expression). lint-staged will reformat.
- Dropped chip presentation (title/description, Escape handling) is covered by the full inline block; the old `Not rendered: {reason}` fallback now comes from the block's own `[data-ptah-ui-reason]`, which the new spec asserts (`:70-74`). No regression found there.
- `displayId` input default `undefined` is never exercised for display parts (message-text always passes `string | null`); fine, it keeps the inline path unchanged.

## Focus checks

- Closed vs streaming: PASS. An unclosed display fence stays in the trailing markdown part until closed (segmenter unchanged), tested at spec `:51-58`.
- Invalid: PASS for reserved ids and compile errors via the block's own reason path (safe text, raw fence shown as code). See M1 for drift.
- Superseded / evicted: PASS for renderer retention and status copy; "Open latest" for superseded and no action for evicted/invalid are correct in the template (`display-chip` template). See M2/M3.
- VS Code host-null: PASS. `inject(..., {optional:true})` for both tokens; `available()` false yields the "unavailable" note with no action, while the block renders in full.
- Shared data / read-only: the block resolves via the same host sources as before (`PTAH_UI_HOST_SOURCES`), so inline and sheet read the same facts; interaction is local to the block. Not proven by test (S1).
- Untrusted HTML: PASS. No `innerHTML`; the chip uses text interpolation only, content goes through the existing pipeline and renderer, markdown via `SurfaceMarkdownPipe`.
- Output seam: `openInDisplayRequested` is exposed on both the chip and `ptah-ui-message-text` and emits the surfaceKey. Nothing binds it yet (Batch 4); until then the button is a no-op for users, which is accepted by the batch boundary but must be bound before merge. The chip preserve list (pending, invalid, in display, updated later, evicted, open action) is kept, minus the old expandable title/description detail; pin belongs to Batch 4.
- Dock ports (`PTAH_UI_DISPLAY_DOCK`, `displayFenceKey`) unchanged.

## Required to approve
1. Fix S1 (unique DOM ids; confirm no state keyed by shared surfaceId) with a test.
2. Reuse the shared reserved-id check (M1).
3. Add the missing state tests (M2, M3).

## Re-review

Review family: Claude reviewer, codex implementer. Score: 8/10. Verdict: APPROVED.

- S1 duplicate DOM ids: fixed. `reasonId` is now a per-instance counter id (`ptah-ui-block.component.ts` `reasonId = ptah-ui-reason-N`), used for both the reason element and `aria-describedby`; the display id feeds only compilation (`compileSurfaceId`). The read-only interaction object is now per instance (`readOnlyInteraction()`), so historical blocks sharing a display id do not alias view state. The fix report cites a spec mounting two turns with one display id and asserting distinct ids and independent state; the orchestrator's chat-ui test run passes.
- M1 shared validation: fixed for named ids. They compile through the exported `compileDisplayFences`, so the reserved-id rule and its reason text come from `display-surfaces.ts`, and the block no longer carries its own copy. Residual: the block hands the whole raw text to the collection compiler and takes the first fence (`[0]?.compiled`), falling back to an internal error if none parses; that is correct for a single-fence `raw`, but a segmenter change that emitted zero display fences for the raw would surface as "internal error" rather than silently. Acceptable.
- M2/M3 state specs: the fix report lists pending, dock-invalid, same-id update, hidden action for invalid/evicted, "Open latest" label, host-null no-action, and a remount-as-snapshot case for an already superseded or evicted block. That matches the matrix I asked for; I did not re-run the specs myself, and rely on the orchestrator's passing run.
- M4 host-null noise: fixed; the chip renders only when both a dock and host sources exist.
- Still outstanding by design: nothing binds `openInDisplayRequested` until Batch 4. It must be bound before merge, otherwise the Open in display button does nothing.
