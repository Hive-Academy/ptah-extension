# Batch 28 fix report — Task 28.1, decision #125

Executor: frontend-developer. Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`. No git commands run.

## Files touched

- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts`
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.spec.ts`

No other file changed.

## Steps

1. Component: removed the `import { fenceCodeBlock } from './code-fence'` line (was line 7), the public `formattedDiff`
   computed and the private `generateUnifiedDiff` method (were lines 185-218). The class now ends after `blockLabel`
   (lines 178-183). Nothing else became unused: `computed`, `input`, `splitLines`, `DiffRow` and the language utils are
   still used by `rows`, the counts and the labels. `code-fence.ts` is untouched; `code-fence.spec.ts` keeps the fence
   contract.
2. Spec: deleted the standalone `describe('DiffDisplayComponent')` block that held the case "fences a diff beyond the
   longest backtick run in either input" (was lines 7-32). Reason as recorded in #125: it pinned only dead code.
3. Spec: added `it('renders backtick runs and markup in either string as plain text')` at line 85, inside
   `describe.each([true, false])` (line 9), so it runs for both `isElectron` values. Input: `old_string` = three
   backticks, `new_string` = ten backticks + `\n<div class="fixed">x</div>`. Asserts the `.diff-code` texts are exactly
   `['```', '``````````', '<div class="fixed">x</div>']`, and that `host.querySelector('div.fixed')` is `null`.
4. Spec: removed `provideSurfaceActiveTesting()` and `provideMarkdown()` from the `providers` array (line 37) and their
   imports (`@ptah-extension/core/testing`, `ngx-markdown`). The spec passes without them (check 1 below). The providers
   are now `FILE_LINK_OPENER` and `VSCodeService` only.
5. No stubs or TODOs.

## Verification (run one at a time from the worktree root, through the Bash tool)

1. `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/tool-execution --coverage=false --maxWorkers=2 --moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}'`
   -> `Test Suites: 6 passed, 6 total`, `Tests: 174 passed, 174 total`. (Diff spec net change: -1 deleted case, +2 from
   the new case running for `isElectron` true and false.)
2. `npx nx typecheck @ptah-extension/chat-ui --parallel=1` -> `Successfully ran target typecheck for project
   @ptah-extension/chat-ui` (`ngc --noEmit`, no errors).
3. `npx nx lint @ptah-extension/chat-ui --parallel=1` -> `8 problems (0 errors, 8 warnings)`, target succeeded. The
   batch note gives a baseline of 0 errors / 9 warnings; none of the 8 warnings is in the diff-display files (the
   output was filtered for `diff-display` and showed none).

The Nx Cloud 401 notice ("organization disabled") was printed after both Nx targets; it does not affect the local run.
