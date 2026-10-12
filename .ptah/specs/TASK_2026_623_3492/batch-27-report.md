# Batch 27 report: P2 tool-call header, tool-call item, ChatView Escape guard

Executor: frontend-developer. Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`. No git state changed. `batches.md` and `decisions.md` were not edited.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-call-header.component.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-call-header.component.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\molecules\tool-execution\tool-call-item.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\molecules\tool-execution\tool-call-item.component.spec.ts` (only the import lines and the new cases changed; the existing case body is the same, checked with `git diff -U0`, which removes only two import lines)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts` (one line)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts` (one new case added; nothing else changed)

Not touched: `libs/frontend/chat-ui/src/index.ts`, `code-output.component.ts` and its spec.

## Task 27.1: tool-call header

Line references are to `tool-call-header.component.ts`.

- **Toggle and sibling open button.** The toggle `<button #toggle>` is at L91-226. It has `aria-expanded` (L96). It has `aria-controls="tool-<id>"` only while expanded (L97), because the item renders that region only when expanded. For file tools the open-file button is a separate 28 px (`h-7 w-7`) `<button>` next to the toggle, not inside it (L229-243). Its accessible name is `"Open <file name>"` and its `title` is `"Open <full path>"`. It opens through the injected `FILE_LINK_OPENER` with `origin` set to the host element (`openFile`, L532-540). A rejection is logged and not rethrown, the same as `file-path-link`.
- **File preview header (R7.5).** The file name is in `font-semibold` and the directory is muted; the full path is in `title` (L125-139). The path wraps (`break-all`). The language label is `getLanguageLabel(getLanguageFromPath(filePath))` (L337-339), rendered at L140-145. The Batch 26 util is used as built (#117).
- **Bash (R7.2).** The toggle keeps the description, or the command cut to 40 characters, with the full command in `title` (`describeToolTarget`, unchanged). The command row (L247-267) shows `$`, a mono `<code>` holding the full command, and `title` set to the full command. While the item is collapsed the row is one line with an ellipsis (`truncate`). When expanded it wraps (`whitespace-pre-wrap break-all`, L259-261). `<ptah-copy-text-button label="Copy command">` copies the exact command (L265).
- **Outcome (R7.3, A9).** `commandOutcome` (L353-365) gives "succeeded" for complete, "failed" for error and "running" for streaming. The pill (L173-190) shows the visible text, and its icon has `role="img"` with the name "Command succeeded", "Command failed" or "Command running". A9 resolved: `ExecutionNode` has no exit code (searched `libs/shared/src/lib/types/execution/node.ts` for "exit": no match), so the planned fallback is used and no "exit code N" is shown.
- **Status icons of other tools.** Their icons now have names: "Completed" (L193), "Failed" (L200), and "Running" on the streaming spinner (L211).
- **Kept from before:**
  - gold `mcp__ptah` badges ("Ptah Superpower" and the short tool name);
  - the status-coloured tool badge;
  - the streaming description, with the target hidden while streaming;
  - the parse-error warning;
  - the duration badge.
- **Focus.** `focusToggle()` (L374) is a public method that the item calls on Escape.
- **No sideways scroll (#119, R9.5).** The command and the path wrap, or end in an ellipsis in the collapsed one-line row. The header has no `overflow-x` class anywhere, and a spec case asserts this.
- **`index.ts` (#117).** No export was added. The header, which is in chat-ui, is the only consumer of `CopyTextButtonComponent` and the language utils. The chat lib imports neither, so per #117 nothing becomes public API.

## Task 27.2: tool-call item

Line references are to `tool-call-item.component.ts`.

- The item is still collapsed by default, and the permission auto-expand effect is unchanged (L139-145).
- The Escape handler is bound with `host: { '(keydown.escape)': 'onEscape($event)' }` (L60). `onEscape` (L169-181) applies #120(b) as amended by #121(b), in this order:
  1. If `event.defaultPrevented` is true, return and do nothing (L170).
  2. If a permission request is pending, `preventDefault()` + `stopPropagation()` and return. The item stays open (L171-175).
  3. If the item is collapsed, return and let the event bubble.
  4. Otherwise collapse the item, call `headerRef()?.focusToggle()`, then `preventDefault()` + `stopPropagation()` (L177-180).
- `code-output` was not edited. Its own Escape handling (Batch 26 fix) runs first because it is the innermost element.

## Task 27.3: ChatView guard

- `chat-view.component.ts` L515: `if (event.defaultPrevented) return;` is the first line of `onEscapeKey`. Nothing else in ChatView changed (`git diff -U0` shows one hunk, `@@ -514,0 +515 @@`).
- New spec case, `chat-view.component.spec.ts` L2192: overlay mode at width 500 with the panel open. A cancelable Escape whose default is already prevented is dispatched. Result: `closeAgentPanel` is not called (spy) and the panel is still the overlay. The existing overlay-close cases pass and were not edited.

## Specs

- **`tool-call-header.component.spec.ts`:** 23 cases, each run with `isElectron` true and false, so 46 tests. Providers in both runs: `FILE_LINK_OPENER` mock, `Clipboard` mock, and `VSCodeService` `{ isElectron }`. Covered:
  - gold badges and the status badge;
  - `aria-expanded` and `aria-controls`, and the toggle emitting its event;
  - file name, directory, `title` and language label ("TypeScript", "Plain text");
  - the open button: a sibling of the toggle, named "Open util.py", calling `FILE_LINK_OPENER` with path and origin; a rejection is logged; tools without a path have no open button;
  - the Bash description with its `title`, and the 40-character cut;
  - the command row collapsed (`truncate`) and expanded (wraps);
  - "Copy command" copies the exact command;
  - no `overflow-x` or `whitespace-nowrap` class;
  - the three outcome texts with their icon names and no "exit code";
  - no pill while pending;
  - the named Completed and Failed icons;
  - the streaming description with the named spinner;
  - the Bash streaming description next to the running pill;
  - the parse warning, the duration badge and `focusToggle`.
- **`tool-call-item.component.spec.ts`:** the existing case is unchanged. A new `describe.each([true, false])` block adds 8 cases, so 16 tests. It uses a real `CodeOutputComponent` child, reached through the real `ToolOutputDisplayComponent` with a 10-line Bash output so the code-output can collapse. An outer `keydown` listener on a wrapping container stands in for the ChatView handler. Cases:
  - collapsed by default;
  - permission auto-expand shows the card;
  - Escape on an expanded item: it collapses, the toggle gets focus, `defaultPrevented` is true, and the outer listener is not reached;
  - Escape on a collapsed item: the event is not prevented and the outer listener is reached;
  - an Escape that is already `defaultPrevented`: the item stays expanded;
  - **integration (1)**, L197: inner code-output collapsed. Only the item collapses, the toggle gets focus, and the outer listener is not reached;
  - **integration (2)**, L209: permission pending. The item stays expanded, the event is prevented, and the outer listener is not reached;
  - **integration (3)**, L222: inner code-output expanded. Only the code-output collapses: its toggle reads "Show full output" and has focus. The item stays expanded and the outer listener is not reached.

## Decision #8

There is no `isElectron` gating in any changed file. Every new spec block runs under `describe.each([true, false])` with `{ provide: VSCodeService, useValue: { isElectron } }`. File opening goes through `FILE_LINK_OPENER` in both runs.

## Verification

All commands were run one at a time from the worktree root. Each Jest run used the command-line `--moduleNameMapper` override for `^vscode$` and `^marked$`.

1. Jest on the header spec: **Test Suites 1 passed of 1; Tests 46 passed of 46**. Re-run after the prettier formatting: same result.
2. Jest on the item spec and the chat-view spec: **Test Suites 2 passed of 2; Tests 88 passed of 88**. Re-run after formatting: same result.
3. `npx nx typecheck @ptah-extension/chat-ui --parallel=1`: **Successfully ran target typecheck**.
4. `npx nx typecheck @ptah-extension/chat --parallel=1`: **Successfully ran target typecheck**. It printed one template warning about `res.target?.name` in a file outside this batch.
5. `npx nx lint @ptah-extension/chat-ui --parallel=1`: **0 errors, 9 warnings**. None of the warnings are in the batch files; this is the same count Batch 26 recorded.
6. `npx nx lint @ptah-extension/chat --parallel=1`: **0 errors, 34 warnings**. Two of the warnings are in batch files, and both predate this batch:
   - `chat-view.component.spec.ts:1357`, a non-null assertion that this batch did not write;
   - `chat-view.component.ts`, `max-lines` (the file was already over 700 lines; this batch adds one line).

Lint ran before prettier was applied. Prettier changed only whitespace in the three new or rewritten files, and both Jest runs passed again afterwards. `prettier --check` is clean on the header component and the header spec. `tool-call-item.component.spec.ts` keeps one long line in the existing case, which predates this batch; prettier's re-wrap of that line was reverted so the existing case stays unedited.

## Deviations

1. **The file path inside the toggle is no longer clickable.** The plan and design-spec section 6 require a separate open button next to the toggle (buttons cannot nest), so the old `ptah-file-path-link` span inside the toggle was replaced by name and directory text, and the open action moved to the "Open <file>" button. Opening a file still goes through `FILE_LINK_OPENER`. `ptah-file-path-link` itself is unchanged and is still used by `diff-display`. This is the plan's design, not an added behaviour, but it changes where the user clicks, so it is listed here.
2. **The Bash command row shows while collapsed.** Design-spec section 6 puts the command row in the "Always visible" column (collapsed: one line with ellipsis; expanded: wraps), and plan component 11 says "wraps when expanded, `title` holds the full text". That adds one line to a collapsed Bash row. The R7.9 height check in V1 (Batch 33) should measure against the header's 36 px. If V1 rules the row must show only when expanded, the change is one `@if`.
3. **`chat-ui/src/index.ts` was not changed** (#117: the chat lib imports none of the new chat-ui symbols). The batch lists the file only conditionally.
4. **No exit code** (A9): none exists, so the planned fallback is used. No deviation from the plan.

The Escape order, the ChatView change and the public API all match the constraints; none of them is a deviation.

## Out-of-scope observations

- Pre-existing lint warnings in `chat-view.component.spec.ts:1357` and `chat-view.component.ts` (`max-lines`), plus the `res.target?.name` warning from `ngc` in the chat project.
