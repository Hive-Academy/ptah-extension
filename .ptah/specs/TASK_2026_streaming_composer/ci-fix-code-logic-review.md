# CI fix code logic review

Review family: codex (implementer: claude)

Score: 7/10

Verdict: REVISE

## Numbered defects

1. **The Stop handoff has a short interval with no usable Stop.** `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:549,628` removes the old Stop and inserts the new one as soon as `isCompact()` changes. The same change immediately makes the old fold inert (`:221,622`), while `chat-input.component.css:64-80` animates the receiving fold from `0fr` and `composer-compact-bar.component.ts:96-105` fades its row from zero opacity. During folding, the bar Stop exists in the DOM but starts clipped and transparent; during expansion, the card Stop exists but starts inside the zero-height clipped card. A user can momentarily have no pointer-usable Stop while the tab is still streaming, including when a queued send needs Stop to drain. Coordinate the handoff with the visual transition or keep one stable hit target available throughout it. This is a transient interaction defect, not evidence that task-374 still times out: Playwright's click should normally wait until the animation settles.

2. **The new regression test does not establish its “clickable” claim or cover the handoff.** `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.streaming-fold.spec.ts:278-298` asserts one matching DOM node and no `[inert]` ancestor only after `settle()` in each state. It does not test clipping, opacity, hit testing, or the transition between states. It also omits the draft-keeps-card-open case. The test does catch the original duplicate-id/inert-card mistake in settled states; strengthen the coverage with an actual browser click during a fold or a browser-level hit-test assertion, and assert one card Stop with a draft during streaming.

## Logic checked

- **Root cause confirmed.** Before this diff, the card Stop rendered for every busy tab even when the full fold was inert (`chat-input.component.ts:221`) and clipped to `0fr` (`chat-input.component.css:74-80`); the bar Stop used `composer-compact-stop`. A bounding-box visibility assertion could therefore select the card Stop while the composer root received the click. The reported task-374 failure is consistent with that state.
- **Settled states have exactly one Stop per composer.** Both branches use the same busy predicate and opposite `isCompact()` conditions (`chat-input.component.ts:549,628`). The store derives compact from streaming, no draft, no focus, no overlay/drag, and no temporary user expansion (`libs/frontend/chat/src/lib/services/composer-compact.store.ts:64-86`). A pending draft keeps the card open, so its Stop remains. The canvas tile uses its own session context and per-component compact store (`chat-input.component.ts:712-723,870-878`), so the focused tile's scoped selector finds its own bar Stop once folded. Electron may mount another composer elsewhere, but task-374 scopes to `ptah-canvas-focus-area`.
- **Affected e2e specs:** task-374 (`apps/ptah-electron-e2e/src/specs/task-374-abort-then-next-turn.spec.ts:121-153`) should find and click the folded bar Stop after the animation; subsequent busy states still expose it and idle states remove it. Task-360 and task-382 use `chat-stop-btn` only to assert zero Stops after the relevant tab is idle, so the id move preserves their intended checks (`task-360-failed-start-leaves-tab-idle.spec.ts:128,146`; `task-382-late-post-turn-event.spec.ts:227,243`). This is a logical review, not an e2e pass claim.
- **Stop behavior:** both buttons call `handleStop()`; the bar routes through `stopFromCompact()` first (`chat-input.component.ts:630-631,907-910,1946-1955`). That extra method sets `focusTextareaOnExpand`, so when the stream ends and the card expands, the focus effect can restore focus to the textarea (`:948-967`). The card path does not set it because it is already open. No abort or focus regression is apparent from the id/gate change.
- **Old id references:** no live source, e2e spec, or showcase selector still uses `composer-compact-stop`. Remaining mentions are historical text in `.ptah/specs/TASK_2026_streaming_composer/ci-fix-report.md:23,35` and `.ptah/specs/TASK_2026_streaming_composer/visual-review.md:29,35`; the latter's recorded selector is stale for the current UI. The showcase director uses `chat-stop-btn` (`apps/ptah-electron-e2e/src/showcase/_harness/director.ts:608`).

## Verification limits

Reviewed the four-file `git diff`, the CI fix report, composer/store/CSS, the three e2e specs, and references to both ids. The implementer's report records a successful `npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat` (six tasks); I did not rerun it. No Electron e2e or rendered browser check was run under this read-only review's check restrictions, so transition behavior is inferred from the CSS and component state changes.

## Re-review round 1

Review family: codex (implementer: claude)

Score: 9/10

Verdict: APPROVED

### Numbered defects

None.

The revised spec confirms that the folded Stop is the sole `chat-stop-btn`, sits inside the compact bar and outside the inert card, and calls `handleStop()` and `abortWithConfirmation()` once when clicked (`libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.streaming-fold.spec.ts:294-318`). It also covers streaming with a draft: the card stays open, owns the sole non-inert Stop, and its click follows the abort path once (`:320-337`). The template gates the card and bar Stops on opposite `isCompact()` states (`chat-input.component.ts:549,628`), and the bar emits through `stopFromCompact()` to `handleStop()` (`composer-compact-bar.component.ts:67-75`; `chat-input.component.ts:907-909`).

The unit-test `.click()` checks event wiring, not browser hit testing. The reported CI pass on head `5f48cfa17` includes Electron e2e shard 4 and task-374's actual Playwright `stop.click()` (`apps/ptah-electron-e2e/src/specs/task-374-abort-then-next-turn.spec.ts:123-129`), which supplies that integration evidence. I did not rerun checks under this read-only review. The approximately 200 ms transition limit is accepted in `ci-fix-report.md` under Known limits; this round changed no product code and did not worsen it. The CLI skill loader was unavailable in this lane, so I read the repository's `angular-frontend-patterns` skill directly.
