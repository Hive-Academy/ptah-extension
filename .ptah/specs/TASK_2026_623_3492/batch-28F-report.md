# Frontend implementation — `TASK_2026_623_3492`, batch 28F

**Tasks completed**: 28F.1, 28F.2, 28F.3

## Files

All under `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\`:

- MODIFIED `...\code-output.component.ts`: `collapsible` splits on `/\r\n|\r|\n/` (line 185). Doc comment now says the terminators are CRLF, CR or LF.
- MODIFIED `...\code-output.component.spec.ts`: 4 new cases (line 349 onward).
- MODIFIED `...\tool-input-display.component.ts`: adds a private `writeLines` computed (lines 295-303). It drops one trailing CRLF/CR/LF, then splits on `/\r\n|\r|\n/`. `writeLineCount` (line 305) and `writePreviewCollapsible` (line 332) both read it, and the doc comments are updated. The file is 487 lines, under the 500 limit.
- MODIFIED `...\tool-input-display.component.spec.ts`: 4 new cases (line 502 onward).
- MODIFIED `...\tool-call-header.component.ts`: the `tool-file-path` span (lines 126-131) has static classes `flex-1 min-w-0 font-mono text-[10px]`, plus `[class.truncate]="isCollapsed()"` and `[class.break-all]="!isCollapsed()"`. `[title]="filePath()"` is kept in both states. This mirrors the Bash command row.
- MODIFIED `...\tool-call-header.component.spec.ts`: 1 new `it.each` with 3 cases (line 362 onward).
- MODIFIED `...\diff-display.component.ts`:
  - `splitLines` (line 31) splits on `/\r\n|\r|\n/`.
  - New caption "Snippet lines" (`data-testid="diff-gutter-caption"`, `text-[10px] text-base-content-muted`) at the end of the header row (line 91).
  - `blockLabel` (line 193) is now `Diff of <name>, line numbers count within the replaced snippet`.
  - The `DiffRow.lineNumber` doc names the numbers as snippet-relative (#132).
  - Gutter numbers stay `aria-hidden` with unchanged ordinals. No file-relative range.
- MODIFIED `...\diff-display.component.spec.ts`: 3 new cases (line 153 onward), plus one existing assertion updated (see Plan deviations).

## Evidence per task

Every new case sits inside the file's existing `describe.each([true, false])` block, so each one runs with `isElectron` true and false.

### 28F.1: CRLF-safe row estimate

**code-output** cases:
- "shows no toggle for 6 CRLF-terminated lines of 100 characters": no toggle, no "Show full output", not `is-clipped`.
- "shows the toggle for 7 CRLF-terminated lines of 100 characters": toggle reads "Show full output" and the block is `is-clipped`.
- "shows no toggle for empty output"
- "shows the toggle for one 701-character line (wrapped rows)"

**tool-input-display** cases:
- "shows no toggle for 11 CRLF-terminated lines of 100 characters and counts 11 lines": no toggle, not clipped, keeps `max-h-96`, and the count reads "11 lines".
- "shows the toggle for 12 CRLF-terminated lines of 100 characters": "Show all 12 lines", `is-clipped`.
- "reports \"Show all 11 lines\" for 11 CRLF-terminated longer lines": reports 11, not 12.
- "counts lines separated by a lone CR": "5 lines".

**Note on the trailing terminator:** the collapsible estimate now drops the trailing terminator in the same way as the line count. Without that, 11 CRLF-terminated lines would yield a 12th empty row and become collapsible, which would fail the acceptance bullet.

### 28F.2: collapsed header path on one line

There is one case, "keeps a collapsed %s path on one line and wraps it when expanded", run as an `it.each` for Read, Write and Edit. It uses a path of exactly 200 characters, and the case asserts that length.
- **Collapsed:** the span has `truncate`, `flex-1` and `min-w-0`, lacks `break-all`, and its `title` is the full path.
- **Expanded:** the span lacks `truncate`, has `break-all`, and its `title` is unchanged.

Height in px is not asserted here; Batch 33 Task 33.3 covers it.

### 28F.3: diff snippet gutter and CRLF split

- "captions the gutter as snippet lines and names it in the region label": the caption text is "Snippet lines" with the muted `text-[10px]` classes, and the region's `aria-label` contains "line numbers count within the replaced snippet".
- "shows no file-relative line range": no `/line \d+ of/i` and no `/L\d+-\d+/`.
- "splits CRLF strings with no \r left and the same counts as LF": no `.diff-code` text contains `\r`. The codes and counts match the LF equivalent ("3 lines removed, 2 lines added").

## Verification

All checks were run in bash from the worktree root, one at a time.

1. `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/tool-execution --moduleNameMapper='{...}' --coverage=false --maxWorkers=2`
   - Result: `Test Suites: 6 passed, 6 total` / `Tests: 202 passed, 202 total`.
   - That is the baseline of 174 plus 28 new: 4 + 4 + 3 + 3 cases, each run twice.
   - The first run failed only because the 28F.2 test path was 191 characters instead of 200. The fixture string was fixed and the next run was green.
2. `npx nx typecheck @ptah-extension/chat-ui --parallel=1`: "Successfully ran target typecheck".
3. `npx nx lint @ptah-extension/chat-ui --parallel=1`: `8 problems (0 errors, 8 warnings)`, which equals the baseline. None of the warnings is in `molecules/tool-execution`; a grep for the path returned no warning lines.

## Plan deviations

- **One existing spec line in `diff-display.component.spec.ts` was edited.** It is line 142 in the case "is a focusable, labelled, max-h-64 block that wraps and never scrolls sideways". It asserted `toBe('Diff of source.ts')`, which directly contradicts the required new `blockLabel`. Only the expected string changed, to `'Diff of source.ts, line numbers count within the replaced snippet'`. All other existing cases are unedited. No other spec in `libs/frontend` asserts this chat-ui label; the `git-ui` "Diff of" labels are a separate component.

## Out-of-scope observations

None.
