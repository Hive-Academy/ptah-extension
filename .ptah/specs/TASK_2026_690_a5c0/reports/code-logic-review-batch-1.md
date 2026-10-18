# Code Logic Review, Batch 1 (Height and centering), TASK_2026_690_a5c0

Review family: Claude reviewer, codex implementer.

Score: 6.5/10. Verdict: REVISE (one failing spec, small structural nits; the layout logic itself is sound).

Evidence: full diff of the Batch 1 files read; ran only `chat-session-layout.component.spec.ts` (jest, 1 of 2 tests fails). No build or app run, so all rendered-behaviour claims are by source reasoning.

## Blocking
None.

## Serious

### S1. Spec test 2 fails (jsdom does not apply the component stylesheet)
- File: `libs/frontend/chat/src/lib/components/templates/chat-session-layout.component.spec.ts:56-65`
- Run result: `expect(style.display).toBe('flex')`, received `""`. The `:host` rules in `styles:` are not resolved by jsdom `getComputedStyle`, so display, min-height, overflow and the `--chat-content-max-width` custom property all read empty.
- Impact: the geometry contract is unprotected, and the batch ships a red spec. Test 1 (projection order, parent `viewChild`, `@for` re-render, nothing duplicated) passes and covers N4 well.
- Fix: drop the computed-style assertions, or assert against the stylesheet text (read the injected `<style>`), or cover the height chain in the visual/e2e pass. Do not keep an assertion jsdom cannot evaluate.

## Moderate

- M1. Scrollbar-induced misalignment between answer column and composer. `chat-transcript.component.css:49-50` centers `.chat-scroll-content` inside the scroller (whose client width excludes the 8px scrollbar), while the composer and controls centre in the full width (`chat-view.component.html:127`, `chat-input.component.ts:543/583`). With a long transcript the transcript column sits about 4px left of the composer. The gutters match (transcript `calc(100% - 1.5rem)`, composer `px-3` at `chat-input.component.ts:161`), and the 1440 px (758) and 760 px (736) widths are otherwise consistent. Add `scrollbar-gutter: stable both-edges` on the scroller, or accept and document it.
- M2. `overflow-hidden` was added in three nested places (`chat-view.component.html:5`, `:100`, and the layout host `chat-session-layout.component.ts:21`). It fixes the bounded chain, but it will clip any composer popover or tooltip that is `position:absolute` and overflows the column edges. Fixed-position overlays are unaffected. This is unverified in the VS Code webview and Canvas split mode, so include it in the visual pass (model/effort menus, autocomplete, `@` file menu). The Canvas split path is not made worse structurally: the layout host is `flex:1 1 0%; min-height:0`, equivalent to the old `flex-1 min-h-0` wrapper.
- M3. Unrelated deletions in `chat-view.component.ts`: the JSDoc above `DOCK_KEY_STEP` (diff near line 181) and the "Budget banner state belongs to this view's tab" comment (near line 234) were removed. Line count stays 2080, but this is collateral damage in a file the plan said to leave alone. Restore both comments.
- M4. The 758px literal appears in the token definition (`chat-session-layout.component.ts:14`), as fallbacks in `chat-transcript.component.css:50` and `chat-input.component.ts:584`, and in the spec. `sessionControls` (`chat-view.component.html:127`) has no fallback and uses an inline `style`, so outside the layout host the max-width is invalid and ignored. Acceptable today (only ChatView hosts it), but prefer a class over inline style.

## Minor

- `chat-session-layout.component.ts:5-27` and the spec are not prettier-formatted (one-line `:host(.hidden) { display: none; }`, long spec lines); lint-staged will reformat.
- `chat-view.component.html:97-130` and `:265-271`: nested wrapper indentation is off and the stray `</div>` closes `sessionControls` before the comment, which is correct but hard to read.
- Class `flex-1` in `chat-transcript.component.html:2` duplicates the new `flex: 1 1 0%` in the CSS; harmless.

## Focus checks

1. Single scroller, bounded chain: PASS by source. The only `overflow-y:auto` in normal chat is `.chat-scroll-container` (`chat-transcript.component.css:36-42`). Chain: main column `flex-1 min-h-0 overflow-hidden`, then layout host `flex:1 1 0%; min-height:0`, then `[sessionTranscript]` `flex-1 flex-col min-h-0`, then the transcript host (`flex-1 flex flex-col min-h-0`, `chat-transcript.component.ts:277-279`), then the scroller `flex:1 1 0%; min-height:0`. The competing `height:100%` is gone. The composer is a `flex-shrink-0` sibling in normal flow, with no gap and no hidden-scrollbar trick. The now-dead `.chat-scroll-container` rules in `chat-view.component.css` were correctly removed (they never applied under view encapsulation). The unmeasured app-shell `min-h-0` deferral (N3) is reasonable, but the batch-1 measurement checklist must be run.
2. Shared width: PASS. A single `--chat-content-max-width` is consumed by transcript content, composer card, status row and the controls column. `.cs-answer` is released from its 600px cap via `:host ::ng-deep .cs-answer { max-width:100% }` (specificity beats the Tailwind `max-w-[600px]` utility at `message-bubble.component.html:70,92`). Answers therefore widen to the column. That is intended, but body text now runs to 758px at 1440, so check line length visually. See M1 for the 4px scrollbar offset.
3. N4 projection: PASS. `ptah-chat-session-layout` uses `<ng-content>`, so `viewChild` queries, the transcript `@for` and `ChatInputComponent` stay in ChatView's view and nothing is rendered twice (spec test 1 confirms). Default slot first, then the named slots, matches the source order (header and banners above the transcript). The `[class.hidden]` and `[attr.inert]` bindings now sit on the layout host; `:host(.hidden)` has higher specificity than `:host` display:flex, so hiding still works (and the global Tailwind `.hidden` also applies).
4. 683 pane-switch and first-frame restore: PASS by source. `ptah-pane-switch-enter`, `#messageContainer`, `ptahTranscriptPrependAnchor` and `data-testid` are on the same unchanged scroller element (`chat-transcript.component.html:1-12`). `overflow-anchor:auto` is kept (`css:34`) and no sticky elements exist in the transcript or view templates (grep). The 12px translateY entrance is now inside three `overflow:hidden` ancestors, so it is clipped at the bottom edge only, which is negligible.
5. VS Code and Canvas: no structural regression found (see M2). The right DISPLAY rail (`DisplayDockComponent` import and usage) is untouched.
6. File growth and rules: `chat-view.component.ts` 2080 to 2080 and `chat-transcript.component.ts` untouched. The new component is standalone, OnPush, and uses `ng-content`; no Angular rule violations. The only spec weakness is S1.

## Five logic questions (brief)

1. Silent failure: none of consequence; the failing spec is loud. A bad height chain would fail silently as a page-level scroll, so the rendered measurement (reports/batch-1.md items 1-2) remains required.
2. Unexpected user action: opening composer popovers near the column edge (M2).
3. Wrong data: very long unbroken content in an answer now runs to the full 758px column instead of 600px; check `overflow-x` on code blocks.
4. Dependency failure: not applicable (CSS and layout only).
5. Missing: no rendered check at 760/1440 and no VS Code/Canvas pass yet; the app-shell `min-h-0` question stays open pending measurement.

## Required to approve
1. Fix or remove the failing computed-style test (S1).
2. Restore the two deleted comments in `chat-view.component.ts` (M3).
3. Decide on M1 (`scrollbar-gutter`) and run the M2 visual check.

## Re-review

Review family: Claude reviewer, codex implementer. Score: 8.5/10. Verdict: APPROVED.

- S1 failing spec: fixed. The layout now carries static host classes (`chat-session-layout.component.ts:6`), and the spec asserts them (`spec:54-66`); the orchestrator's nx test run passes. The `:host(.hidden)` rule (specificity 0,2,0) still beats the `.flex` utility, so the hide binding works.
- M1 scrollbar offset: fixed with `scrollbar-gutter: stable both-edges` (`chat-transcript.component.css:43`). Symmetric gutters keep the transcript column on the composer's axis. Residual: reserves about 16px total even with a short transcript, so the column is 8px narrower per side than the composer's outer edges; acceptable, confirm in the 760px measurement.
- M2 clipping: the three `overflow-hidden` rules are removed from the main column, the transcript wrapper and the layout host (`chat-view.component.html:5,100`); the `min-h-0` chain remains and the transcript scroller still owns vertical scroll. The popover table is source-based and plausible (all composer menus are in-place descendants). Rendered confirmation per host remains with the orchestrator's visual pass, and with no ancestor clipping the bounded chain relies on `min-h-0` alone, so the 1440/760 measurement of "no second scroller" is the one remaining check.
- M3 comments: restored. Accepting chat-view.component.ts at 2082 lines (HEAD 2080): the two extra lines are the restored comments, and Batch 1 added only the import and component registration there.
- M4 literal 758px/inline style: unchanged, accepted as minor.
