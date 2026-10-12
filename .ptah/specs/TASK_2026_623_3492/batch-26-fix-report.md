# Batch 26 fix report — Task 26.3 (decisions #118, #119, #120(a))

## Files touched

- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts`
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.spec.ts` (new cases appended inside the existing `describe.each([true, false])`; `git diff -U0` on the spec removes no line, so the original cases are unchanged; Prettier reformatted only the new lines)

`tool-language.utils.ts` and `copy-text-button.component.ts` are unchanged.

## #119 — code wraps, no horizontal scroll

- `code-output.component.ts:85` — `overflow-x-auto` removed from the block class list.
- `code-output.component.ts:86-87` — the vertical `max-h-48` + `overflow-y-auto` limit is kept for the expanded and the non-collapsible states (no change).
- `code-output.component.ts:118-122` — in the component styles, `pre, code` inside `.tool-output-markdown` get `white-space: pre-wrap; overflow-wrap: anywhere;`. The existing padding and 10 px / 1.4 type are kept. The selector is `:host ::ng-deep .tool-output-markdown pre`, which is more specific than Prism's `pre[class*=language-]` / `code[class*=language-]`.
- Spec `code-output.component.spec.ts:287-299` — the block never carries `overflow-x-auto`, collapsed or expanded (and it has `max-h-48` when expanded).

## #118 — wrapped rows count for every language

- `code-output.component.ts:176-191` — `collapsible` adds `max(1, ceil(line.length / WRAP_CHARS))` rows per line for every language (the markdown-only branch is gone). It is collapsible when rows > `COLLAPSED_ROWS` (6). `clipped = collapsible && !expanded`, so a block that is not collapsible is never clipped.
- Spec cases (`code-output.component.spec.ts:261-285`): 6 short lines -> no toggle, not clipped; 7 short lines -> toggle; 3 TypeScript lines of 250 characters -> toggle, clipped.

## #120(a) — Escape on the expanded block

- `code-output.component.ts:57` — host binding `(keydown.escape)` -> `collapseOnEscape($event)`. It covers the toggle, the copy button and the focusable region.
- `code-output.component.ts:68`, `:205-206` — `#expandToggle` ref via `viewChild<ElementRef<HTMLButtonElement>>`.
- `code-output.component.ts:212-224` — while `expanded()`: `preventDefault()`, `stopPropagation()`, collapse, focus the toggle (it stays rendered and now reads "Show full output"). When not expanded it returns early, so the event is not prevented and bubbles. This follows the existing `turn-summary-chip.component.ts:377-383` pattern.
- Spec cases (`code-output.component.spec.ts:301-348`):
  - Expanded + Escape -> `aria-expanded="false"`, "Show full output", `is-clipped`, `document.activeElement` is the toggle, `defaultPrevented` is true, and `stopPropagation` was called.
  - Collapsed + Escape -> `defaultPrevented` is false, `stopPropagation` was not called, an outer listener receives the event once, and the block stays clipped.

## Verification (worktree root, one at a time)

- `npx jest -c libs/frontend/chat-ui/jest.config.ts <tool-language.utils.spec.ts> <copy-text-button.component.spec.ts> <code-output.component.spec.ts> --coverage=false --maxWorkers=2 --moduleNameMapper=...`: **Test Suites: 3 passed, 3 total; Tests: 91 passed, 91 total**. That is 79 before plus 12 new (6 cases × 2 host flags).
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1`: **Successfully ran target typecheck**.
- `npx nx lint @ptah-extension/chat-ui --parallel=1`: **0 errors, 9 warnings**. These are the same 9 warnings as the baseline, and none is in code-output.
- `npx prettier --write` on the two files: component unchanged; spec reformatted (only the new lines).
