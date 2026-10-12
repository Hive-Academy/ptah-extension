# Review of GAP rulings #118 and #120

**Overall verdict: REVISE.** The no-measurement approach is viable because the non-collapsible branch is vertically scrollable, but #118 overstates what its estimate proves. More importantly, #120 does not require the outer tool item (or the pending-permission no-op) to consume Escape, so the event can reach the ChatView overlay handler and perform a second, unrelated Escape action.

## #118 — AGREE-WITH-CHANGE

The design choice is acceptable: avoiding one `ResizeObserver` per tool row is reasonable, and the fixed row calculation is cheap and deterministic. The required all-language calculation is also directionally correct: `max(1, ceil(length / WRAP_CHARS))` accounts for a long ASCII code line after R9.5 wrapping (`decisions.md:122`; `batches.md:1750-1753`).

However, it cannot establish that the toggle appears whenever rendered content exceeds 6 rows. `WRAP_CHARS = 100` is a character count, while actual wrapping depends on container width and glyph width (`code-output.component.ts:22-25,182-189`). At `chat-narrow`, a six-line output with 60–100 ASCII characters per line can visually occupy more than six rows; CJK/wide glyphs can occupy roughly double the inline width; and markdown can introduce structural spacing independently of character count (`design-spec.md:197-198,209-213`). The three named cases only prove the threshold and a long Latin-line case (`decisions.md:122`; `code-output.component.spec.ts:261-285`); they do not cover narrow containers, CJK/wide text, or structural markdown.

This does **not** currently produce clipped content with no toggle: when `collapsible()` is false, the block uses `max-h-48 overflow-y-auto`, rather than the clipped 9.6em class (`code-output.component.ts:86-88,98-111,195-197`; test assertion at `code-output.component.spec.ts:199-206`). It can nevertheless produce a user-visible, height-limited scrolling output with no “Show full output” affordance. That is materially different from “at worst a toggle shows that changes little.”

Required change to #118:

- State the fallback accurately: a low estimate yields an unlabelled vertical-scroll state, not a no-effect state; it must remain reachable and readable.
- Add a verification requirement for six nominal rows at `chat-narrow` containing wide/CJK characters, and a multiline/structural markdown sample. The Batch 33 visual check must use those named inputs at `chat-narrow` and `chat-wide`, assert no clipping or horizontal overflow, and record whether the fallback scroll state is intentionally acceptable. If the product requires the toggle whenever rendered content exceeds the collapsed height, a character estimate alone is insufficient; use a conservative width-aware estimate or permit targeted measurement.

## #120 — AGREE-WITH-CHANGE

The innermost-first rule is correct. An expanded `code-output` must collapse, restore focus to its still-rendered toggle, and consume Escape; a collapsed one must let Escape reach the enclosing item (`decisions.md:124`; `batches.md:1750-1753`). This agrees with the R9 accessibility contract that Escape collapses the expanded component and returns focus to its toggle (`task-description.md:907-909`; `design-spec.md:232-233`). The existing implementation shape demonstrates the intended boundary: the inner handler prevents default and stops propagation only while expanded (`code-output.component.ts:217-224`), with both paths covered by its tests (`code-output.component.spec.ts:314-346`).

The outer half is incomplete. #120(b) says the future `tool-call-item` collapses unless `event.defaultPrevented`, and is a no-op during a pending permission (`decisions.md:124`; `batches.md:1778-1779`), but it does not say that either of those consuming branches calls `preventDefault()` and `stopPropagation()`. Without that rule, Escape bubbles to the ChatView host. Its overlay handler closes the agent panel whenever overlay mode is open, and it does not test `event.defaultPrevented` (`chat-view.component.ts:208-210,514-518`). Thus one Escape from an expanded tool item can both collapse/refocus the item and close the overlay; during a pending permission, the specified “no-op” can still close the overlay. That violates the stated nested-Escape ownership and surprises keyboard users.

Required change to #120 and Batch 27:

- When `tool-call-item` collapses, it must `preventDefault()` and `stopPropagation()` after restoring focus to the header toggle.
- When a pending permission makes Escape a no-op for the item, it must still consume the event (`preventDefault()` and `stopPropagation()`), so “no-op” means no enclosing Escape action.
- Make `ChatView.onEscapeKey` return immediately for `event.defaultPrevented` as a defensive cross-component contract; then handle its own overlay Escape only when unclaimed.
- Add integration cases for (1) collapsed inner `code-output` → outer item alone collapses and the ChatView handler is not called; (2) pending permission → neither item nor overlay closes; and (3) expanded inner `code-output` → only it collapses. The current item spec has no Escape coverage (`tool-call-item.component.spec.ts:1-21`), so it cannot establish the Batch 27 contract.

## Five logic questions

1. **Silent failure:** #118 can silently substitute a vertically scrollable block for the advertised expansion affordance when real wrapping exceeds the estimate (`code-output.component.ts:182-189,195-197`).
2. **Unexpected user action:** Pressing Escape in an expanded item, or during a pending permission, can bubble to and close the narrow overlay (`chat-view.component.ts:514-518`) unless #120 requires consumption.
3. **Wrong-answer input:** Narrow containers, wide/CJK glyphs, and structural markdown make the 100-character row estimate wrong (`code-output.component.ts:24-25`; `design-spec.md:197-198,209-213`).
4. **Dependency failure:** No external dependency is introduced by either ruling. Clipboard failure is separately contained by the copy atom (`copy-text-button.component.ts:86-96`) and is not relevant to the two decisions.
5. **Missing requirement:** The decisions lack an explicit cross-component Escape-consumption contract and an acceptance rule for an underestimated wrapped-height result.

## Evidence and scope

Read in full: `code-output.component.ts` and its spec, `tool-language.utils.ts`, `copy-text-button.component.ts`, `tool-call-item.component.ts` and its spec. Reviewed the requested decision, batch, requirements, plan, design, report, and ChatView Escape paths. Scoped diagnostics reported no diagnostics in the three requested component files; sibling-project diagnostics are pre-existing noise and do not evidence these rulings. No tests, builds, Nx targets, or source edits were run.
