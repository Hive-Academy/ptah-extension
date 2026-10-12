# Batch 26 report — P1: tool-language util, copy-text button, code output

Executor: frontend-developer. Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`. No git state changed.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\utils\tool-language.utils.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\utils\tool-language.utils.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\atoms\copy-text-button.component.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\atoms\copy-text-button.component.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\code-output.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\code-output.component.spec.ts` (additions only; `git diff -U0` shows no removed lines)

`libs/frontend/chat-ui/src/index.ts` is unchanged, as the batch requires. `ptah-copy-button` is unchanged.

## Task 26.1 — tool-language util

Public API (Batches 27-28 build on this):

- `getLanguageFromPath(filePath: string): string`. This is the old private method, moved as is: `\` is normalised to `/`, the last `.` segment is lower-cased, and an unknown extension gives `text`.
- `detectToolLanguage(source: ToolLanguageSource): string`, where `ToolLanguageSource = Pick<ExecutionNode, 'toolName' | 'toolInput' | 'toolOutput'>`. It is the old `detectLanguage()`, now a pure function of the node:
  - `mcp__*` gives `markdown`;
  - Read, Write and Edit use the file extension;
  - Bash gives `bash`;
  - string output that parses as one JSON object or array gives `json`;
  - output that only starts with `{` or `[` keeps the tool's language. The guarded `JSON.parse` is kept.
- `getLanguageLabel(language: string): string` is new. It is needed for the language label (R7.5) and the Batch 27 header pill. Examples: "TypeScript", "Bash", "JSON", "Plain text". An unmapped id is returned unchanged.
- The extension map is the module-private `LANGUAGE_BY_EXTENSION`, with the same 20 entries as the old `languageMap`.

Naming deviation: `detectLanguage` was renamed `detectToolLanguage` and `languageMap` was renamed `LANGUAGE_BY_EXTENSION` (not exported). A free function called `detectLanguage` would be ambiguous outside the component.

Behaviour is equivalent. The old `else if (Grep || Glob) language = 'text'` branch was dropped because it was a no-op: `text` is already the default. The old `if (!node) return 'text'` guard is unnecessary because `node` is `input.required`.

`code-output` imports the util and keeps no private copy. The existing detection cases still pass, unedited: json, JSONL with no throw, `[NX]` log line gives bash, fence lengths, and markdown left unfenced.

## Task 26.2 — `ptah-copy-text-button`

- Inputs: `text` (required string) and `label` (required string, used as the accessible name and tooltip). There are no outputs. This matches D15.
- Pattern: standalone, OnPush, `inject(Clipboard)` from `@angular/cdk/clipboard`, signal state `idle | copied | failed`, Lucide icons Copy, Check and X (with `aria-hidden`).
- A polite live region (`role="status"`, `aria-live="polite"`, `sr-only`) announces "Copied" or "Copy failed". The same text replaces the tooltip while the feedback shows.
- Failure handling: a `false` return or a thrown error from `clipboard.copy` shows "Copy failed" and adds `text-error`. Nothing is rethrown.
- Feedback resets after 2 s. The timer is cleared on re-click and on destroy through `DestroyRef`, so it always has a release path.
- The button is disabled when `text` is empty. It is 28 px (`h-7 w-7`) and `type="button"`.

## Task 26.3 — code-output

- The pipeline is split into computeds:
  - `plainOutput`: MCP extraction, then stripping of system reminders, ANSI codes and `N→` prefixes. This is the existing order, unchanged.
  - `language`: `detectToolLanguage(node)`.
  - `formattedOutput`: the same result as before.
- The toolbar holds:
  - a language label badge (`data-testid="code-output-language"`);
  - the "Show full output" / "Show less" toggle with `aria-expanded` and `aria-controls` pointing at the block id. It only renders when the output is collapsible;
  - `<ptah-copy-text-button label="Copy output">`, which copies `plainOutput` (the stripped text, not the fenced markdown).
- The block is `role="region"` with `tabindex="0"` and `aria-label="<toolName> output"` (falling back to "Tool output"). It has a focus-visible outline (2 px `base-content`, 2 px offset, per design-spec section 8).
- Collapsed state: the `.is-clipped` style sets `max-height: 9.6em` (the block's text is 10 px), `overflow-y: hidden`, and a fade made with a `mask-image` gradient. There is no extra DOM, and the clipped text stays in the accessibility tree.
- Expanded state, or output that is not collapsible: the original `max-h-48 overflow-y-auto overflow-x-auto` scroll is kept.
- Collapsibility is estimated from rows instead of measured layout, so there is no ResizeObserver per tool row:
  - code counts one row per line, because it scrolls sideways;
  - markdown output adds about one row per 100 characters, because it wraps;
  - output is collapsible when it has more than 6 rows. That is the number that fits in 9.6em at 10 px with a 1.4 line height and `pre` padding.

## Decision #8 (both webviews)

There is no `isElectron` gating anywhere. The new spec blocks (`copy-text-button` and the new `code-output` describe) run under `describe.each([true, false])` with `{ provide: VSCodeService, useValue: { isElectron } }`.

## Deviations

1. The util names differ from the moved private names (see 26.1). The signatures are stated above for Batches 27-28.
2. `getLanguageLabel` is an addition beyond the three moved functions. It is required for the language label.
3. Collapsible detection uses a row estimate, not measurement (runtime-cost rule). If the estimate is wrong the only effect is a toggle that changes little. Content is never hidden without a toggle unless a markdown line runs past about 100 characters per row at a very narrow width.
4. Design-spec section 6 says "code never scrolls horizontally; wraps". The batch says to keep the existing `overflow-x-auto` scroll, so the batch was followed and wrapping was not added.
5. Escape-to-collapse (R9.1) was not added here. It belongs to the tool-call item in Batch 27.

## Verification (from the worktree root)

- Jest, run with the command-line `--moduleNameMapper` override on the three specs and `--maxWorkers=2`: **Test Suites 3 passed of 3; Tests 79 passed of 79**.
  - `tool-language.utils.spec.ts`: 36 cases.
  - `copy-text-button.component.spec.ts`: 7 cases × 2 hosts.
  - `code-output.component.spec.ts`: the 11 original cases, unedited, plus 9 new cases × 2 hosts.
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1`: **Successfully ran target typecheck**.
- `npx nx lint @ptah-extension/chat-ui --parallel=1`: **0 errors, 9 warnings**. None of the warnings are in the batch's files; they are pre-existing in other files. Three warnings in the new files (two non-null assertions and one useless assignment) were fixed before the final run.
- Spec-file types: `ptah_get_diagnostics` reports no errors in the three spec files. It reports 8 pre-existing errors in sibling files outside this batch: `streaming-quotes.component.spec.ts`, `compact-session-activity.component.spec.ts`, `core/src/testing/mock-rpc-service.ts` and `shared/.../capability-id-codec.ts`.
- `prettier --check` on the six files: clean.

## Out-of-scope observations

- The pre-existing type errors listed above, which `ngc` for the lib does not cover because it excludes spec files.
- Lint warning in `molecules/agent-card/agent-card-output.component.ts:10`: `signal` is imported but never used.
