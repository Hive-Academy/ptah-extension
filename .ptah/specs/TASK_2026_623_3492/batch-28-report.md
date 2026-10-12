# Batch 28 report - P3 diff, input and output displays (TASK_2026_623_3492)

Executor: frontend-developer. No git commands run; working tree left dirty.

## Files

Root: `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\`

- MODIFIED `...\diff-display.component.ts` - rows rendered natively: counts, line-number and sign gutters, row tint, language label, focusable labelled `max-h-64` block, wrapping.
- MODIFIED `...\diff-display.component.spec.ts` - new `describe.each([true, false])` block (7 cases).
- MODIFIED `...\tool-input-display.component.ts` - full Bash `command` and Write `content`, Write preview (language label, line count, "Show all N lines", "Copy content", Escape per #120(a)), wrapping, Input toggle `aria-expanded`, private language map removed in favour of the util, stale comment corrected.
- MODIFIED `...\tool-input-display.component.spec.ts` - new `describe.each([true, false])` block (12 cases, 14 tests per host).
- MODIFIED `...\tool-output-display.component.ts` - stale "chat-ui is type:ui" comment corrected (`:91-95`). Nothing else changed: routing, retention notice and error alert are as before.
- MODIFIED `...\tool-output-display.component.spec.ts` - new `describe.each([true, false])` block (6 cases).

Not touched: `code-output`, `tool-call-header`, `tool-language.utils`, `copy-text-button`, `chat-ui/src/index.ts`, batches.md, decisions.md.

## Task 28.1 - diff display

- Imports `getLanguageFromPath` and `getLanguageLabel` from `../../utils/tool-language.utils` (`diff-display.component.ts:11-14`). No language map of its own.
- Header (`:49-82`): `flex-wrap`. Kept: the `ptah-file-path-link` (still opens through `FILE_LINK_OPENER`) and the replacements badge (`:72-81`, same text and plural). Added: a language label (`:57-61`, design-spec section 6 Edit meta bar), and removed/added counts `-N +M` (`:62-70`). The coloured digits are `aria-hidden`; an `sr-only` sentence reads "2 lines removed, 1 line added" (`countsLabel`, `:170-177`).
- Body (`:84-115`): `tabindex="0"`, `role="region"`, `aria-label="Diff of <file name>"` (`blockLabel`, `:179-183`), `max-h-64 overflow-y-auto`, focus-visible ring. One row per line from `rows` (`:153-164`), old lines first, then new lines (order kept). Each row has:
  - a line-number gutter (`aria-hidden`);
  - a sign glyph `-` / `+` with `role="img"` and `aria-label` "removed" / "added";
  - a `bg-error/10` / `bg-success/10` tint;
  - a code cell styled `white-space: pre-wrap; overflow-wrap: anywhere` (`:122-125`).
- The diff has no `overflow-x-auto`. Old line `:60` had it and it is removed.
- The rows are plain DOM with no timer or observer per row.

## Task 28.2 - tool input display

- Full text (R7.2, R7.7): `isFullTextParam` (`:435-440`) exempts Bash `command` and Write `content` from the cut, and `inputParams` (`:271-284`) applies it. Other strings keep the 60-character rule (`PARAM_PREVIEW_CHARS`, `formatValue`). Values render `whitespace-pre-wrap break-all` (`:157`), so multi-line commands keep their line breaks and wrap.
- Trivial-input hiding (`hasNonTrivialInput`) is unchanged. The retention notice is unchanged and stays outside the guard.
- Write preview (content over 200 characters, the parity threshold; `:88-149`):
  - Meta row: a language label from the util (`writeLanguageLabel`, `:299-306`) and "N lines".
  - "Show all N lines" / "Show less" toggle with `aria-expanded` and `aria-controls` (`:112-125`).
  - `<ptah-copy-text-button label="Copy content">`, which copies the raw `content` string.
  - A focusable `role="region"` block labelled "Write content: <file name>".
  - The collapsed block is clipped to 15.4em (11 rows) with the code-output fade (`:184-197`), and the clipped text stays in the DOM. Expanded, or when there is no toggle, it uses the existing `max-h-96 overflow-y-auto`.
  - Whether the toggle appears is estimated from wrapped rows, the same rule as code-output and #118 (`writePreviewCollapsible`, `:321-328`).
- Escape follows #120(a): `(keydown.escape)` sits on the preview wrapper (`:93`). `collapsePreviewOnEscape` (`:425-432`) acts only while the preview is expanded. It collapses the preview, focuses the toggle, and calls `preventDefault()` + `stopPropagation()`. While the preview is collapsed it returns and the event bubbles. No other Escape handling was added.
- Wrapping: `overflow-x-auto` is removed from the param container (old `:59`) and from the expanded markdown block (old `:76`). `pre, code` inside `.tool-output-markdown` use `pre-wrap` + `overflow-wrap: anywhere` (`:204-208`).
- The private `languageMap` / `getLanguageFromPath` copy (old `:194-215,316-320`) is deleted, and the util is used instead (`:303,403`). The util's `getLanguageFromPath` is the same function with the same 20 entries and the `text` default (#117).
- The `ExpandableContentComponent` ("Show/Hide content (N lines, M chars)") is no longer used here. The design's "Show all N lines" toggle replaces it. The atom stays in the codebase because chat uses it.
- Input toggle: now carries `aria-expanded` and `aria-controls`, and its glyph is `aria-hidden` (`:65-79`). The design-spec section 7 pattern asks for this; it has no behaviour change.
- Stale comment corrected (`:237-248`): chat-ui is `type:feature` (project.json tags, eslint lattice) and may import chat-streaming. The comment now says the shared typed field is the reader/writer contract.

## Task 28.3 - tool output display

- Routing, the retention notice and the error alert are unchanged. Only the stale comment is corrected (`:88-100`).
- The component itself carries no horizontal-scroll class. Its routed children (code-output, diff, todo list) are checked in the spec.

## Listed risks and constraints

| Constraint / risk | Handling |
| --- | --- |
| Use the Batch 26 API; no re-implementation | util imports in diff and input; `ptah-copy-text-button` in input; no clipboard call, no language map left in these files. |
| No horizontal scroll (#119, R9.5) | No `overflow-x-auto`/`-scroll`/`whitespace-nowrap` in the three files. Every spec asserts `querySelectorAll(HORIZONTAL_SCROLL)` is empty in every state: diff spec `:152`; input spec `:423` (collapsed section, clipped preview, expanded preview, long Bash command); output spec `:325` (code-output collapsed and expanded, Edit diff, TodoWrite). |
| Height-limited blocks focusable and labelled | Diff region (`aria-label` "Diff of source.ts", spec `:152`); Write preview region (spec `:363`). |
| Diff: path link, replacements badge, old-then-new order, counts, gutters, tint | Spec `:76`, `:88`, `:116`, `:125`, `:131`, `:139` (opener called with the path). |
| Input: full command, full Write content, 60-char rule, trivial hiding, retention | Spec `:325`, `:342`, `:334`, `:350` (Edit/TodoWrite/Read), `:484`. |
| Write preview toggle follows #120(a), plus the two #120 cases | Spec `:451` (expanded: collapsed, toggle focused, defaultPrevented, stopPropagation) and `:469` (collapsed: bubbles to the outer listener). |
| Output: routing, retention, error | Spec `:263`, `:279`, `:294`, `:301`, `:308`. |
| Decision #8 / R7 host risk (plan validation, MEDIUM) | Every new block is `describe.each([true, false])` with `{ provide: VSCodeService, useValue: { isElectron } }` (diff `:38`, input `:232`, output `:209`); no `isElectron` gating; file opening through `FILE_LINK_OPENER` in both. |
| Existing spec cases unedited | `git diff -U0` removes no line from the input or output specs. In the diff spec, the only removed lines are the two import statements at `:1-2`, widened to add `ComponentFixture` and `VSCodeService`. The original case is byte-for-byte unchanged. |

## Deviations

1. **`DiffDisplayComponent.formattedDiff` kept, but not rendered.** The diff is now built as DOM rows, because a per-line `aria-label` on the sign glyph cannot be put on Prism-highlighted markdown. `formattedDiff` (the fenced unified-diff text, `:185-198`) is still public because the existing, unedited spec case pins its fence-safety contract. Nothing in the template reads it. **Ruling needed:** keep it as the text form, or delete it together with that spec case.
2. **Prism diff highlighting replaced by row tint.** The old Prism `diff` language only coloured whole `+`/`-` lines. It did not syntax-highlight the code, so the tint gives the same signal (now with glyph text as well). The `@@ Edit @@` hunk line is not rendered: it is a Prism marker, not a parity item.
3. **Diff meta bar has no "Lines 41-46".** Edit input has no file offset, so the line numbers count within the edited snippet (old lines 1..n, new lines 1..m). User-visible.
4. **Write meta reads "N lines", not "New file - N lines".** Write input cannot tell a new file from an overwrite. User-visible.
5. **Write preview collapsed state.** Before, the collapsed state showed a 60-character italic excerpt plus "Show content (N lines, M chars)". Now the highlighted preview always shows, clipped to 11 rows, with "Show all N lines". This is the design-spec section 6 behaviour, and the parity row "Write content over 200 characters: expandable highlighted code" is kept. User-visible.
6. **Input toggle `aria-expanded`/`aria-controls`.** Added in place (design-spec sections 7-8). No behaviour change.

No parity item from parity-inventory section 4 was dropped.

## Verification (run one at a time from the worktree root)

1. `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/tool-execution --coverage=false --maxWorkers=2 --moduleNameMapper='{...vscode, marked...}'`
   - Result: **Test Suites: 6 passed, 6 total; Tests: 173 passed, 173 total**.
   - The first run had 2 failures: my own new case read markdown text before render finished. I added `await fixture.whenStable()` to that new case and re-ran. No existing case was involved.
2. `npx nx typecheck @ptah-extension/chat-ui --parallel=1`: **Successfully ran target typecheck**.
3. `npx nx lint @ptah-extension/chat-ui --parallel=1`: **0 errors, 8 warnings**. The baseline was 9; the drop is the unused `signal` import removed from diff-display. None of the remaining warnings is in a Batch 28 file.

## Out-of-scope observations

- `ptah-file-path-link` (atom, not in this batch) uses `truncate` (nowrap + ellipsis) for the diff header path. That is not a horizontal scroll, but design-spec section 7 says path rows wrap. Batch 33 V1 should look at it.
