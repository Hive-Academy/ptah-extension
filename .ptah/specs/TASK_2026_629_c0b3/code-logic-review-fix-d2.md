# Code Logic Review - Fix D2 (scoped re-review)

Scope: uncommitted diff of `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts` and its spec.
Spec of the fix: `recheck-s12-report.md` F-E and `code-logic-review-fix-d.md` M1. Read-only; I did not run the spec.
Checks 1-3 are verified statically against source, typings and a recomputed contrast table. Nothing was rendered in a browser.

## Summary

| Metric | Value |
|---|---|
| Score | 5/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 3 |
| Moderate | 2 |
| Minor | 1 |

The disposal logic is sound (`DestroyRef.destroyed` exists, the timer is cleared, the sequence guard works). The three things the fix was meant to deliver are not delivered in production:

- The re-announce on a repeated rejection does not reach the DOM.
- The visible notice sits below the fold.
- The class used trips a repo-wide ratchet test.

The spec passes only because it calls `fixture.detectChanges()` between steps that the real app never separates.

## Findings

### 1. (Serious) The repeated-rejection re-announce is a no-op in the running app; the spec hides this

- File: `canvas-detail-transcript.component.ts:111-126`. Spec: `canvas-detail-transcript.component.spec.ts` lines ~157-166 of the diff (the "clear, microtask, set" block).
- Scenario: the notice is showing, and the user clicks the same unavailable tile again within 4 s.
  - `showUnavailableNotice` runs `clearAgentNotice()`, which sets the signal to `''`.
  - It then queues a microtask that sets the signal to the message again.
  - No change detection runs between a synchronous click handler and the microtask. The microtask queue drains before Angular's `onMicrotaskEmpty` or the zoneless scheduler's rAF/timeout callback.
  - So the template only ever sees `"msg"` followed by `"msg"`. The interpolation binding is unchanged, no DOM write happens, and the polite live region says nothing.
  - This is exactly M1-A from `code-logic-review-fix-d.md`, still present for the first 4 s after each rejection. The app uses `provideZonelessChangeDetection` (`app.config.ts:142`) and zone.js as a fallback; both paths drain microtasks before rendering.
- Why the spec is vacuous: after the second `openLane` the test calls `fixture.detectChanges()` and asserts `status.textContent === ''`. That forces a render between the clear and the microtask, which production cannot do. Replace that call with a single `await Promise.resolve(); fixture.detectChanges();` and the text is unchanged both before and after, so no mutation occurs. The spec passes while the behaviour is broken.
- Fix: make the clear and the set span a real render.
  - Use a macrotask: `clearAgentNotice(); setTimeout(() => set(msg), ~100)`. A short delay is the usual live-region pattern. Track and clear this timer in `clearAgentNotice` as well, and keep the sequence guard.
  - Or, without timers, render the text in a child keyed to the sequence. Example: a `noticeSeq` signal driving `@for (s of [noticeSeq()]; track s) { <span>{{ agentNotice() }}</span> }` inside the persistent live region, so the text node is replaced on every rejection.
  - Fix the spec so a second rejection is followed by exactly one `detectChanges()` after the microtask or timer drain, and add a mutation-level assertion. Use a `MutationObserver` on the status element, or count text-node replacements. This must fail on the current code.

### 2. (Serious) The visible notice is outside the viewport, and the always-rendered span adds a permanent ~8 px of scroll

- File: `canvas-detail-transcript.component.ts:38-41`. Context: `canvas-lane-view.component.ts:50,65-68`.
- Layout chain (static analysis, not rendered):
  - The transcript host is `block h-full min-h-0`.
  - Its first child is `ptah-chat-view`, an inline host with no `:host` display. Its root is `div.flex.h-full.w-full` (`chat-view.component.html:1`), which resolves to 100% of the transcript host.
  - The status span follows that 100%-high block. It is `block px-3 py-1`, so with empty text it still takes 8 px of padding.
  - Check 1 answer: yes, an empty always-rendered span takes ~8 px, and it is not absorbed by the host. Host content height becomes 100% + 8 px (28 px with one line of text).
  - The transcript host sits in `div.h-full` inside `div.rail-focus-fade.h-full`, inside the lane-view host, which is `overflow-auto` (`canvas-lane-view.component.ts:50`). The overflow therefore creates a permanent 8 px vertical scroll range, with a scrollbar on classic-scrollbar platforms, and it nudges the layout.
  - When the notice does appear (rejected tile click), it renders at the bottom of that overflow, below the chat view's own height, so a sighted user does not see it without scrolling. That is the F-E scenario the fix was meant to remove.
- Fix: make the host a flex column with a persistent, zero-height live region.
  - Host: `flex flex-col h-full min-h-0`.
  - Wrap the outlet in a div: `<div class="flex-1 min-h-0"><ng-container *ngComponentOutlet .../></div>`.
  - Notice: `<div role="status" aria-live="polite" class="shrink-0">` containing `@if (agentNotice()) { <p class="px-3 py-1 text-sm text-base-content-muted">{{ agentNotice() }}</p> }`. The live region exists before text is inserted and takes no space when empty, and the visible text is part of the flex flow instead of overflowing.
  - Alternative that also avoids layout shift: host `relative`, region `absolute inset-x-0 bottom-0 pointer-events-none`. It would cover the chat input area, so prefer the flex option.
- Have visual-reviewer confirm after the change; the nested `flex-1`/`min-h-0` chain inside `ptah-chat-view` is the risk.

### 3. (Serious) `text-base-content/80` breaks the repo ratchet `no-alpha-base-content.spec.ts`

- File: `canvas-detail-transcript.component.ts:41`. Guard: `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts:25-26,115-140,197-210`. The spec also asserts the banned class (diff, `classList.contains('text-base-content/80')`).
- The guard sweeps every non-spec `.ts/.html` under `libs/frontend/**` for `text-base-content/\d+`. Only four decorative exceptions are allowed, and the canvas file is not one of them. `expect(offenders).toEqual({})` will fail with `canvas/.../canvas-detail-transcript.component.ts: ['text-base-content/80 x1']`.
- Fix: use `text-base-content-muted`, the token that exists for this purpose (`tailwind.config.js:31`; already used in `canvas-lane-view.component.ts:157`). Update the spec assertion to match, and run the ratchet spec for `ptah-extension-webview` once.

### 4. (Moderate) Check 3: contrast itself is fine; the class is the problem

I recomputed WCAG contrast with `culori` from the literal theme values in `tailwind.config.js`. Values are `base-content` at 80% alpha composited over each background.

| Theme | on base-100 | on base-200 | on base-300 |
|---|---|---|---|
| anubis | 9.75:1 | 9.25:1 | 8.37:1 |
| anubis-light | 8.70:1 | 8.08:1 | 7.70:1 |

All are at least 4.5:1 for these two themes. The repo bans the alpha form anyway because it fails on other shipped themes, for example daisyUI `dark` at /60 (comment at `tailwind.config.js:16-19`). Finding 3 stands regardless. `text-base-content-muted` is 5.0-6.1:1 on these themes, as measured per theme in the config comments.

### 5. (Moderate) The spec depends on the manual change-detection cadence and one `Promise.resolve()` hop

- File: spec lines ~152-188 of the diff.
- Beyond finding 1, the block grows the already-large single `it`: fake timers are installed mid-test, after `settle()`.
- `jest.restoreAllMocks()` in `finally` runs before the `ResizeObserver` restore. This is harmless today, but it is order-sensitive.
- The sequence guard (a stale microtask after a newer click or a destroy) has no dedicated assertion. Two rapid rejections followed by one drain are not asserted to produce exactly one timer.
- Fix: split the notice behaviour into its own `describe` or `it` with its own fixture. Add a case where two synchronous rejections produce a single timer, and a case for destroy-before-microtask (`fixture.destroy()` immediately after `openLane`, then `await Promise.resolve()`, asserting the signal stays `''` and no timer is armed).

### 6. (Minor) Stale-notice edge with the hidden transcript

`CanvasLaneView` keeps the transcript mounted under `[class.hidden]` when a lane tab is selected (`canvas-lane-view.component.ts:67`). A notice armed just before switching lanes will sit inside a `display:none` region until the 4 s clear, or reappear if the user returns within 4 s. This is harmless and bounded by the auto-clear. No change needed unless finding 2's rework wants a clear on `visible()` going false.

## Checks requested

1. Layout shift: yes, a permanent ~8 px overflow, and the notice itself is below the fold (findings 2 and 4 in the order above are 2 and 4; see finding 2 for the fix). A persistent live region is still required. Keep the empty `role="status"` element in the DOM and conditionally render the padded child inside it.
2. Re-announce logic:
   - Correct: sequence guard, 4 s auto-clear, `clearTimeout(undefined)` safety, and the destroyed check in the microtask.
   - `DestroyRef.destroyed` is declared at `node_modules/@angular/core/types/_chrome_dev_tools_performance-chunk.d.ts:793` (`abstract get destroyed(): boolean`), Angular 22.1.7.
   - Setting a signal inside the destroy callback is fine.
   - Not correct: clear-then-microtask does not produce an observable DOM change (finding 1).
3. Contrast: passes (finding 4), but the class is banned (finding 3).
4. Specs:
   - Pre-fix failures exist for the visibility assertions (`sr-only` removed, class present), the 4 s expiry, and the destroy-timer cleanup. The cleanup assertion is genuine: `clearTimeout` must be called with the notice's own handle.
   - The repeat-rejection "empty then message" assertion is a test artifact (finding 1).
   - Fake timers: used in a mostly correct way. `jest.useFakeTimers()` after `settle()` is fine, and the microtask hop is ordered correctly. The sensitivity noted in finding 5 remains.

## Five logic questions

1. Silent failure: a repeated rejected click within 4 s is still silent for assistive technology (finding 1). The visible notice is off-screen (finding 2).
2. Unexpected user action: a scrollbar or 8 px scroll appears on every lane view hosting a transcript, with no interaction (finding 2).
3. Wrong answer from input data: none found.
4. Dependency failure: `detail?.open` absent or false is treated as "unavailable", which is acceptable. No new throw path.
5. Missing: a test that exercises the real render cadence, and a visual check of the notice.

## Verdict

REVISE, 5/10.

- Top risk: the fix's two user-facing goals (visible feedback, re-announce) do not work at runtime, and the ratchet test will fail.
- Robust version: finding 3 swap, finding 2 flex layout with a persistent empty live region and conditional visible child, finding 1 macrotask or keyed re-announce with a real mutation-level test.
