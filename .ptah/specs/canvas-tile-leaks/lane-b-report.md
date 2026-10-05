# Lane B — webview input/scroll forced-layout fixes

Worktree: `D:\projects\ptah-extension\.claude-worktrees\canvas-tile-leaks`
Scope held to: the three named files + `agent-monitor-panel.component.ts` + their `*.spec.ts` files (verified: no other file touched by this lane).

## Files changed

- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts` — JS textarea auto-resize replaced with CSS `field-sizing: content`; all height-write sites removed
- `libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.ts` — bar transition narrowed from `transition-all` to `transition-colors`
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-scroll.directive.ts` — pin measurement coalesced into one rAF per frame, canceled on destroy
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts` — same rAF coalescing for the detail-pane scroll handler, canceled on destroy
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts` — new class-level regression tests for the CSS-sized textarea
- `libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.spec.ts` — new render-level test for the bar transitions
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-scroll.directive.spec.ts` — rewritten for the rAF-coalesced pin measurement (3 tests)
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.spec.ts` — new `sticky-to-bottom scrolling` describe (2 tests), fixed in revision round 1

## Item 1 — textarea auto-resize (chat-input.component.ts)

- `chat-input.component.ts:205-215` — template comment documents the approach.
- `chat-input.component.ts:214` — `style="field-sizing: content"` on the textarea (static attribute; no `[style]` bindings exist on this element, so no binding/static conflict).
- `chat-input.component.ts:215` — class changes: `min-h-[2.5rem]` → `min-h-[calc(2lh+1rem)]`; added `overflow-y-auto`; kept `max-h-[10rem]` (=160px, same cap the JS enforced) and `resize-none`, paddings, `rows="2"`.
  - Why the min-height changed: with `field-sizing: content` the browser ignores the `rows` attribute (MDN: rows/cols "have no effect"), so the old rows="2" resting height (~2×22.75px line-height + 16px padding ≈ 61.5px) had to be re-expressed as a min-height or the empty/after-send box would visibly shrink to a 1-row 40px sliver. `calc(2lh+1rem)` reproduces the old resting height exactly (two lines of `leading-relaxed` + `pt-3 pb-1`); the `lh` unit tracks font-size changes, and engines without `field-sizing` fall back to the still-present `rows="2"` attribute for the identical look. Only visual delta: with exactly 1 line of typed text the box no longer shrinks 61.5→40px mid-typing (the old JS did that); empty, ≥2 lines and the 160px cap are pixel-identical.
- `chat-input.component.ts:751-758` — `handleInput` now only does `this._currentMessage.set(value)`; the `style.height='auto'` + `Math.min(scrollHeight,160)` pair (the ~95ms/keystroke forced full-document layout with ~26,500 layout objects) is gone.
- IME/paste/pickers preserved: `input` events fire during IME composition and CSS sizing follows the live value natively; `handlePaste` still only intercepts image clipboard items (text paste flows to the input event); slash/@ dropdowns still anchor on `textareaOrigin()` (the element itself, not its height).

### Every textarea height-write site found and how it is handled

All height writes for THIS textarea lived in `chat-input.component.ts`; external components reach it only through its public methods (verified by grep over `libs/frontend/chat/src`):

| Site (old line) | Path | Now |
| --- | --- | --- |
| `handleInput` ~:755-756 | every keystroke auto-resize | removed — CSS `field-sizing: content` sizes the box (`:214/:215`) |
| `insertTranscript` ~:988-989 | voice transcript insert (programmatic value set) | removed — `textarea.value = newValue` + field-sizing resizes; focus + cursor restore kept (`:960-985`) |
| `handleSend` ~:1374-1377 | reset after send | removed — `_currentMessage.set('')` flows through the `[value]` binding (`:225`) and field-sizing shrinks the box back to resting height |
| `restoreContentToInput` ~:1410-1411 | history recall / prompt insert / queued-draft restore — called from `chat-view.component.ts:1024, :1060, :1077` | removed — signal set + `[value]` binding + `focus()` kept (`:1398-1402`) |
| `replaceTrigger` ~:1240 / `removeTriggerText` ~:1252 | slash-command insert / @-file tag removal | never wrote height even before (relied on the next input event — stale-height quirk of the old scheme); now automatically consistent via field-sizing, unchanged |

Also found, out of scope (see Open Items): `inline-agent-bubble.component.ts:1049-1051` has the same JS auto-resize pattern for its own separate textarea.

## Item 2 — scroll handlers (agent-lane-scroll.directive.ts, agent-monitor-panel.component.ts)

Approach: coalesce the geometry reads into one `requestAnimationFrame` per frame (task-blessed option). An IntersectionObserver bottom-sentinel was rejected: the panel's scroll container is hidden with `[style.display]` while the lane grid shows (`agent-monitor-panel.component.ts:556`), and a `display:none` element never intersects, which would silently un-pin auto-follow; the lane grid template that hosts the directive (`agent-lane-grid.component.ts:95`) is outside this lane's scope, so a sentinel would have had to be injected from the directive.

- `agent-lane-scroll.directive.ts:43-50` — `onScroll` schedules one rAF (guarded by `measureFrame !== null`); the callback reads `scrollHeight/scrollTop/clientHeight` once and updates `pinned`. Reads no longer happen synchronously in the scroll handler (forced style recalc while streaming). Behaviour identical: RO (`:25-33`) still follows within the frame content grows; scroll-up un-pins; returning within 80px re-pins. Pin state updates at most one frame later than the old synchronous read.
- `agent-lane-scroll.directive.ts:52-56` + `:37` — `cancelMeasure` cancels the pending rAF via `DestroyRef`.
- `agent-monitor-panel.component.ts:1103-1113` — panel `onScroll` gets the same rAF coalescing (same 80px `NEAR_BOTTOM_PX` rule, `:712`).
- `agent-monitor-panel.component.ts:1115-1119` + `:1093` — `cancelScrollMeasure` + `DestroyRef` registration; the sticky RO (`:1081-1092`) is unchanged (its `scrollHeight` read runs post-layout inside the RO callback, which does not force reflow).

## Item 3 — effort-selector bar transitions (effort-selector.component.ts)

- `effort-selector.component.ts:134` — toolbar-pill meter bars: `transition-all` → `transition-colors`. Bindings checked: each bar's `[style.height.px]="4 + bar * 2.5"` (`:142`) is constant per slot; only the background color changes between efforts (`:135-139`), so color is the only property that needs transitioning — `transition-colors` (Tailwind: color/background-color/border-color/text-decoration-color/fill/stroke) cannot start the non-composited `scrollbar-color` transitions that `transition-all` started on every recalculation.
- `effort-selector.component.ts:204-211` — the dropdown's mini bars carry no transition class at all and their color/height never change (per-option constants), so nothing to replace there; left untouched.

## Spec changes

- `agent-lane-scroll.directive.spec.ts` (rewritten, 3 tests): RO + rAF/cancelAnimationFrame mocks; `flushFrames()` helper; independent follow → scroll-up stop → return-to-bottom re-pin per lane (disconnects asserted); burst of 3 scroll events coalesces into 1 scheduled frame and un-pinned lanes stop following; pending measurement canceled on destroy.
- `agent-monitor-panel.component.spec.ts` (new describe, 2 tests): renders the panel with mocked providers (same pattern as the existing `overlay focus` describe); RO/rAF mocks; full pin → unpin → re-pin lifecycle against the real `#agentScroll` container; burst coalescing + destroy-cancel. Revision-round fix (spec bug, not production): `scrollContainerOf` had treated the private `_scroll` viewChild as an `ElementRef`, but `viewChild()` returns a **signal** — it is now invoked (`_scroll()`), matching the production call sites; `createPanel` clears framework-internal rAFs scheduled during setup; the destroy assertion now verifies the production behavior directly (the scroll handler's own handle is passed to `cancelAnimationFrame`) instead of asserting the shared mock map is empty — the framework schedules its own rAFs during fixture teardown, which would otherwise mask the result. Production was correct throughout (`agent-monitor-panel.component.ts:701`, `:1082` call the signal).
- `chat-input.component.spec.ts` (new describe, 2 tests): `handleInput` updates the message signal with zero writes to the textarea style (a Proxy `set`-trap records any attempt — this is the regression the trace flagged); every input event still updates the signal.
- `effort-selector.component.spec.ts` (new describe, 1 test): renders the component and asserts all 5 toolbar bars carry `transition-colors` and not `transition-all`.

## Verification results

Tests (run directly, per revision instruction — Nx is unusable on this machine, see Open Items):

```
npx jest -c libs/frontend/chat/jest.config.ts agent-monitor-panel.component agent-lane-scroll chat-input.component effort-selector --silent --maxWorkers=2
Test Suites: 4 passed, 4 total
Tests:       106 passed, 106 total
Time: ~15-22s, exit code 0
```

(Intermediate state during this round, before the spec fix: 1 failed / 105 passed — the two `scrollContainerOf` failures, then the destroy assertion; both fixed, final run fully green.)

Lint (direct ESLint on the 8 changed files, since `npx nx lint chat` cannot complete here):

```
npx eslint <the 8 changed files>
✖ 2 problems (0 errors, 2 warnings)
```

Both warnings are pre-existing `max-lines` size warnings (`chat-input.component.ts` 1053 lines, `agent-monitor-panel.component.ts` 1035 lines — both were already over the 700-line limit before this lane; the edits reduced both files slightly). Exit code 0.

## Open Items

- No spec asserts the static `style="field-sizing: content"` attribute directly: `chat-input.component.spec.ts` is deliberately class-level (its header documents that full template rendering is avoided in that suite), and a render test would require mocking ~6 child-component service surfaces (ModelStateService, AppStateManager, SessionMcpStatusRegistry, PeerSessionFacade, …) — out of proportion for this batch. The behavioral guard (no height/style writes on input) is covered.
- `inline-agent-bubble.component.ts:1049-1051` still uses the old JS auto-resize for its own textarea (execution bubbles) — out of scope for this lane; candidate follow-up.
- Other scroll-height math in `chat-transcript.component.ts` / `transcript-prepend-anchor.directive.ts` / `tab-bar.component.ts` — out of scope (the trace named only the agent-monitor paths and the composer).
- Stale comment in `chat-view.component.ts:1055` ("handles focus and auto-resize") — `restoreContentToInput` now handles focus only; that file is out of scope to edit.
- Nx-based targets (`npx nx test chat --skip-nx-cache …`, `npx nx lint chat`) never completed: Nx stalls for >10 minutes in project-graph creation on this shared machine (daemon contention with other concurrent agents). Verification used the direct Jest and direct ESLint invocations above.
- Revision note: backticks I originally placed inside HTML comments in the two inline `template:` literals broke compilation (they terminate the backtick-delimited template string); the orchestrator removed them. None remain — no backticks are used inside any inline template literal.
