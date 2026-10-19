# Code Logic Review, Phase B (B1)

Score: 6/10. Verdict: NEEDS_FIXES.

Scope: command-dock.component.ts and spec, command-voice-hud.component.ts and spec, command-session-controls.component.ts and spec, plus the page usage in command-center-page.component.ts. I read the files and the diff. I did not run the tests. Layout findings come from reading the CSS against the grid auto-placement rules, not from a browser.

## Capability and wiring (checked, OK)
- Start new emits newSession. Status emits requestStatus. No resumeLast, canResume or chooseCurrentTab was added (D7, D9 honoured).
- The voice hud keeps every output: start, stop, toggleMute, interrupt and openVoiceSettings.
- The mic and speaker numeric meters keep role="meter" with aria-valuenow. The speaker meter and the waveform show only while speaking.
- The retry and recovery buttons are intact.
- Send guard: the Send button is disabled for an empty draft, and send() returns early on an empty trimmed value.
- Draft handling: the draft is kept after emit. clearDraft(sent) clears only when the trimmed draft equals `sent`, so text typed during an in-flight send is preserved.
- The dock forwards all eight outputs and every input the page binds today (voiceState, provider, muted, turnAbortable, voiceError, inputLevel, outputLevel, sessionStatus). clearDraft is delegated through viewChild.required, which is correct.
- Integration selectors still exist: `button` in the hud, `input`, `form` and `label[for=command-text]` in the controls, and `[aria-label="Command dock"]` on the dock.

## Findings

1. **Desktop layout is not a single row (Serious, MUST-FIX).** command-dock.component.ts:31-45. The default grid places items with definite columns, but the DOM order is identity(1), actions(2), Status(4), Start new(5), then command-entry(3). Under sparse auto-placement, an item whose column is lower than the cursor's previous column moves to the next row. The field therefore lands on row 2, col 3, under an empty cell (or on row 3 when a recovery row is present). That contradicts the report ("desktop single row") and the prototype. The batch report says the final CSS was changed after the checks, so nothing exercised it.
   Fix: give every item an explicit `grid-row: 1` in the base rules and keep `grid-row: 2` on voice-recovery. Alternatively, reorder the DOM or use `grid-auto-flow: dense`. Check it in a browser or in the visual review.

2. **Breakpoints differ from the spec (Serious, MUST-FIX).** command-dock.component.ts:46. The CSS uses `max-width: 1100px` for the three-row layout, but the plan says 900px three-row and <=720px four-row. The media queries use viewport width, while the dock sits in a page column that is narrower once the 336px or 260px rail is subtracted. At a 1100px viewport the column is about 700px, and at 900px it is about 570px, yet the five-column grid still applies up to 1100px. The 900px viewport case does reach the three-row layout, but the 1100px cutoff is unspecified.
   Fix: use `container-type: inline-size` on the dock wrapper with `@container` queries, or at least align the breakpoints to the spec (900 and 720) and document the viewport-versus-column assumption for Phase A. With a container query the layout follows the dock width, which is what actually matters.

3. **Dock tests do not prove layout (Moderate, must-fix with items 1 and 2).** command-dock.component.spec.ts:15-29. The "layout" test only asserts that class names exist and that border-base-300 is absent. jsdom does not apply grid or media queries, so items 1 and 2 passed all 532 tests.
   Fix: add a test that reads the injected `<style>` text and asserts the grid-row rules per breakpoint, or assert the `getComputedStyle` grid-row/column hooks. Better, cover it in the visual-review step with 1440, 900 and 720 screenshots.

4. **Page now renders unframed child sections (Moderate, must-fix before Phase A or as a stopgap).** command-voice-hud.component.ts:12 and command-session-controls.component.ts:11 lost `rounded-xl border bg-base-200 p-3`. command-center-page.component.ts:361-380 still renders the two components directly. The host elements are `display: inline`, they are not wrapped in a bordered card, and `.voice-recovery mt-2` and the other spacing now apply with no container. The current page loses its card styling until A2b lands.
   Fix: if Phase A will not land in the same commit, wrap the page usage in a bordered container, or accept and record this explicitly.

5. **Generic global class names with ViewEncapsulation.None (Moderate).** command-dock.component.ts:44-51. The rules are all prefixed with `.command-dock`, so the leak risk is low. Two exceptions exist: `.command-dock button { transition:none }`, and the `.session-new` and `.voice-*` hooks, which are defined by child components using emulated encapsulation. The selectors work only because the dock's global styles reach into the children's DOM. If the children are rendered outside the dock, those classes have no styling. This is acceptable but fragile.
   Fix: no change required. Add a comment in the children that the dock depends on these hook classes.

6. **display: contents on labelled sections (Moderate).** command-dock.component.ts:37-42. `.voice-hud` and `.session-controls` are `<section aria-label>` landmarks, and `display: contents` on them can remove the landmark and its label from the accessibility tree in older Chrome and Safari versions. Also, `aria-label="Command dock"` on a bare `<div>` (line 14) has no role, so it is ignored by assistive tech. The page spec selects it, so keep the attribute.
   Fix: add `role="group"` to the dock wrapper. For the sections, accept the degradation or do not rely on the landmarks.

7. **The status paragraph and help copy live inside the grid cell (Minor).** command-session-controls.component.ts:26-32. The `aria-live` status line and the Tribunal help text are children of `.command-entry`, so on desktop they make the field cell taller than its siblings. This affects layout only.

8. **Formatting churn (Minor).** The diff collapses the multi-line `title` and `subtitle` ternaries into one-line chains (command-voice-hud.component.ts, last 2 members). That is a style matter for the style reviewer, not a logic problem.

9. **Dead members (Minor).** `canStart`, `listening` and the `meterBars` array are still used. No dead code was found.

## Test quality
- The session-controls and voice-hud spec additions assert behaviour: failed send keeps the draft, empty submit is blocked, and the outputs fire.
- The dock behaviour test is good: it clicks real buttons and checks the outputs, the draft retained, and clearDraft.
- The dock "layout" test mirrors class names only (see item 3).

## MUST-FIX
- Item 1: explicit grid rows so desktop is one row.
- Item 2: breakpoints and container-versus-viewport behaviour.
- Item 3: a test or visual-evidence step that actually checks the layout.
- Item 4: acknowledge or stopgap the unframed page rendering until A2b.
