# Visual Review - TASK_2026_streaming_composer

## Summary

| Metric            | Value                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| Overall score     | 6/10                                                                  |
| Assessment        | NEEDS_REVISION                                                        |
| Visual breaking   | 0                                                                     |
| Serious           | 1 (type-to-expand does not fire after clicking the transcript)        |
| Moderate          | 2                                                                     |
| Viewports tested  | 1 (Electron window 1201x801, default size)                            |
| Screenshots taken | see `%TEMP%\ptah-visual-test\composer\shots\`                         |
| Components tested | chat-input composer, composer-compact-bar, ComposerCompactStore, type-to-expand directive |

## Environment

- Real Electron app, built bundle `dist/apps/ptah-electron/main.mjs` in the `streaming-composer` worktree (already built; not rebuilt by me). Launched through Playwright `_electron` (`launchPtah` from `apps/ptah-electron-e2e/src/support`) with `--force-prefers-no-reduced-motion`. `matchMedia('(prefers-reduced-motion: reduce)')` was `false` during the run.
- Isolated profile and DB (launcher default). No real AI provider: streaming was simulated by pushing `chat:chunk` `message_start` plus `turn_state phase=generating` events (same method as `task-374-abort-then-next-turn.spec.ts`). The transcript therefore only shows the live line "Orchestrating", not real streamed text.
- Input: Playwright `page.keyboard.press` (trusted CDP input).
- Script: `%TEMP%\ptah-visual-test\composer\composer.spec.ts` (+ `glass.spec.ts`), raw numbers in `shots\results.json`.
- Themes: dark = `ptah-glass`, light = `ptah-glass-light` (set through `data-theme` on `<html>` at runtime).
- Only the default window size was exercised. No narrow-width sweep (not asked).

## Check results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Folds to ~40px bar while streaming, empty + unfocused | PASS | Stage height 41.33px, `data-compact` set, `composer-compact-bar` present, status "Ptah is working…", Stop button present (`composer-compact-stop`). Shots: `c1_compact_dark.png`, `c1_compact_light.png`. Model chip count = 0 in this harness (no model resolved): chip NOT verified. |
| 2 | Click bar expands with animation, textarea focused | PASS | rAF samples of stage height after click: 41.3 -> 35 -> 137 -> 165.3 px, spread over ~290 ms (t=372..657 ms in the sample clock). `is-unclipped` flips only after the growth. After: `compact=false`, activeElement = TEXTAREA. Playwright screenshots are too slow to land mid-animation (frames 1-3 `c2_frame1..3.png` are all already expanded), so the intermediate frames are numeric, not visual. Expanded shots: `c2_expanded_dark.png`, `c2_expanded_light.png`. |
| 3a | Click a transcript element, then press a printable key (`a`, `/`, `@`) | **FAIL** | After the click, activeElement = `PTAH-CANVAS-DETAIL-TRANSCRIPT`. Pressing `a`, `/`, `@` leaves the composer compact and the textarea value empty (`""`) for all three. Shots `c3_click_a.png`, `c3_click_slash.png`, `c3_click_at.png`. See defect 1. |
| 3b | Focus on `<body>`, press `a` / `/` / `@` | PASS | activeElement = BODY before. Value is exactly `a`, `/`, `@` (once each); focus moves to TEXTAREA. `/` opens the slash list (28 options), `@` opens the mention list (1 option). `Shift+Q` gives `Q`, typing `bc` afterwards gives `Qbc`. Shots `c3_body_a.png`, `c3_body_slash.png`, `c3_body_at.png`. |
| 4 | Ctrl+K while compact | PASS (with a caveat) | Composer stays compact, textarea empty, keydown not `defaultPrevented` (focus on the transcript wrapper and on body). Shot `c4_ctrlk.png`. Caveat: in this host the chat surface has no Ctrl+K handler (the only one in the repo is scoped to the Tasks view), so "keeps its normal action" means only "the directive does not swallow or expand". Not verifiable beyond that. |
| 5 | File drag held over compact composer > 3 s | PASS | `dragenter` then `dragover` every 150 ms for 4.5 s: composer full (`data-compact` absent, 165 px) at every 500 ms sample; "Drop image here" overlay shown. After `dragleave` it refolds within 3.5 s. Shots `c5_drag_1s.png`, `c5_drag_4s.png`. Synthetic DragEvents with a `DataTransfer` file, not a native OS drag. |
| 6 | Stop on the bar stops the stream | PASS | Click on `composer-compact-stop` produced RPC `chat:abort` with the session id. After the terminal idle `turn_state`, Stop is gone (`chat-stop-btn` count 0), composer is full, textarea focused. Shot `c6_after_stop.png`. The abort RPC was mocked, so "stream stops" is proven at the renderer contract only. |
| 7 | Draft in textarea keeps composer full while streaming | PASS | Typed "my draft", clicked the transcript, blurred, waited 3.5 s: `compact=false`, value `my draft`, height 165 px. Shots `c7_draft_full_dark.png`, `c7_draft_full_light.png`. |
| 8 | Glass: no blur snap at end of expand | PASS with caveat | Per-frame computed styles on every glass surface and the composer wrappers for 1.2 s across the expand: `backdrop-filter`, `opacity`, `filter`, `transform` never change. The only change is `chat-composer-full` `overflow: clip -> visible` at ~755 ms after sampling began (about 240 ms after the click, matching `UNCLIP_DELAY_MS`). Composer pixels are identical across two rest screenshots 500 ms apart. Caveat: I could not capture a pixel frame exactly at the unclip moment, so a one-frame edge change from `overflow: clip -> visible` is not excluded visually. |

## Findings by severity

### Serious

#### 1. Type-to-expand does nothing after clicking inside the transcript (Electron canvas host)

- File: `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts:21` (`host: { tabindex: '-1' }`) against `libs/frontend/chat/src/lib/components/molecules/chat-input/composer-type-to-expand.ts` (`isInTypingScope`, `scope.view.contains(target)`) and `composer-type-to-expand.directive.ts` (`scope()` uses `host.closest('ptah-chat-view')`).
- Viewports affected: all (default 1201x801 tested).
- Screenshot: `c3_click_a.png`, `c3_click_slash.png`, `c3_click_at.png`.
- Problem: in the Electron Rail/canvas, clicking any non-editable transcript element focuses the nearest focusable ancestor, which is `ptah-canvas-detail-transcript` (tabindex -1). Its DOM position is `ptah-canvas-detail-transcript > ... > ptah-session-embed > ptah-chat-view > ... > ptah-chat-input`, so it is an ancestor of `ptah-chat-view`, not a descendant. The key's `event.target` is that wrapper, `scope.view.contains(target)` is false, and the key is ignored. Only the "focus on body" path works.
- Impact: the exact scenario in the task ("click a transcript element, then type") does not expand the composer. A user reading the stream, clicking the text and typing gets nothing, and the keystrokes are lost.
- Fix: widen the scope to the owning session/tile (for example `host.closest('ptah-session-embed, ptah-canvas-detail-transcript, ptah-chat-view')`), or treat a target whose closest focusable ancestor contains the chat view as in scope. Add a spec with focus on the wrapper.

### Moderate and minor

- Slash suggestion popup renders at the top-left of the window (`c3_body_slash.png`), far from the composer. Not compared with `main`, so I cannot say whether the compact change caused it (the new `overflow: clip` window or the popover anchoring is the first suspect). Worth a check.
- Compact bar shows no model chip in this harness (`composer-compact-model` count 0). Could not verify the chip's look; needs a session with a resolved model.
- Height briefly dips from 41.3 to 35 px before growing during the expand (bar collapses first, then the card grows), a small visible "pinch" in the stage height. Likely intended (bar out, card in); noted only.

## Prototype fidelity

- Approved prototype: none found in the task folder for this surface (not searched beyond the review brief). Fidelity: NOT APPLICABLE.
- Before/after comparison: not performed (no base-commit capture was supplied). Dark + light "after" captures are in `shots\` (`c1_*`, `c2_*`, `c7_*`).

## Design system compliance

Not measured. Colours come from existing tokens (`bg-primary`, `bg-error/15`, `surface-2`); no hex values were inspected.

## Accessibility audit

- Bar is a real button with `aria-expanded="false"`, `aria-controls`, `title`, sr-only label (from source); Stop has `aria-label`. Not exercised with a screen reader.
- The folded full composer is `inert` (source). Not tab-order tested.
- Bar button height 32px and Stop 28px (class sizes `h-8`, `h-7`) meet the 24px AA target size; not measured at runtime.

## Visual performance

- Fold/expand is a height animation on `grid-template-rows`; ~290 ms measured, no opacity or filter changes on glass surfaces.
- No console errors were inspected.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for check 3a (reproduced three times with a trusted keyboard, cause traced); MEDIUM for the animation and glass checks (numeric evidence, no mid-frame screenshot).
- Key concern: typing after a click in the transcript does not expand the composer in the Electron canvas, because the focused wrapper sits outside `ptah-chat-view`.

## Re-test (round 2)

Same setup as before (real Electron, freshly built dist, trusted keyboard input, `--force-prefers-no-reduced-motion`). Scripts: `%TEMP%\ptah-visual-test\composer\composer.spec.ts`, `twotile.spec.ts`; screenshots in `shots\`.

| Check | Result | Evidence |
|-------|--------|----------|
| 3a click transcript text, then `a` | PASS | activeElement was `PTAH-CANVAS-DETAIL-TRANSCRIPT`; composer expanded, textarea value exactly `a`, focus on TEXTAREA. `c3_click_a.png` |
| 3a click transcript text, then `/` | PASS | value exactly `/`; list open (28 options). Popover rect x341 y301 w721 h291 bottom 591; textarea rect y595 (4px gap). `c3_click_slash.png` (~500 ms after key) shows the list directly above the composer. |
| 3a click transcript text, then `@` | PASS | value exactly `@`; list open. Popover rect y517 h75 bottom 591; textarea top 595. `c3_click_at.png` |
| 3b body focus: `a`, `/`, `@` | PASS | values `a`, `/`, `@` once each; same popover rects (bottom 591 vs textarea top 595). `Shift+Q` gives `Q`, then `bc` gives `Qbc`. |
| Two tiles: click transcript in tile A, type | PASS | Tile A expanded (41 -> 165 px, value `a`), tile B stayed compact (41 px, value empty). Reverse: click tile B transcript, type `b` -> only B expanded (value `b`), A compact. `tt_after_A.png`, `tt_after_B.png`. Note: before the first click tile B was full only because I had clicked its composer to bind it. |
| Regression 1 (fold) | PASS | stage 41.33 px, compact bar with Stop. |
| Regression 2 (expand) | PASS | 41.3 -> 97.5 -> 165.3 px, unclip at ~563 ms sample; textarea focused. |
| Regression 4 (Ctrl+K) | PASS | stays compact, empty value, not defaultPrevented (transcript wrapper and body focus). |
| Regression 6 (Stop on bar) | PASS | `chat:abort` with session id; after idle composer full, textarea focused. |
| Regression 7 (draft) | PASS | stays full (165 px) with "my draft". |
| Regression 5 (drag > 3 s) and glass | PASS | full for 4.5 s; no filter/opacity/transform changes (glass spec re-run), only overflow clip -> visible. |

Defect 1 (serious) and the top-left popup finding are resolved. Still unverified: model chip in the bar (no model resolves in this harness) and a pixel frame at the exact unclip moment.

Updated verdict: APPROVE, confidence MEDIUM-HIGH.
