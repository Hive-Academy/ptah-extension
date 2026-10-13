# Code style and structure review — tool-call card redesign (round 1 re-review)

Date: 2026-10-13 · Branch: `feat/tool-call-redesign` (uncommitted working tree) · Reviewer: code-style-reviewer
Round: 1 — re-review after the author's fixes for the round-0 findings.

**Score: 9 / 10 — APPROVED**

## What this round did

Verified each round-0 finding against the current tree. Read the three new files in full (`tool-status.utils.ts`, `tool-text.utils.ts`, `tool-output-markdown.styles.ts`) and both barrels. Ran one scoped compiler check on the twelve changed source files. It reports no error in any of them. The 250 errors it lists elsewhere are pre-existing spec errors in files this change does not touch (for example `tab-bar.component.spec.ts`, `send-message-chip.component.spec.ts`, `chat-input.component.spec.ts`). Scoped lint was not run. Nothing below depends on it.

## Status of the round-0 findings

**1. Dead `ErrorAlertComponent` — FIXED.**
The component and its spec are deleted. Both barrel exports are gone: `libs/frontend/chat-ui/src/index.ts` has no error-alert line, and `libs/frontend/chat/src/lib/components/index.ts` no longer exports it. Grep over `libs/` finds one remaining match only: the unrelated `data-testid="peer-session-error-alert"` in `libs/frontend/chat/src/lib/components/molecules/peer-session-send/peer-session-send-dialog.component.ts:217`. That is a plain `alert alert-error` div, not the deleted component.

**2. Markdown block CSS and helper duplication — FIXED.**
- The shared CSS lives in `tool-output-markdown.styles.ts` and is the one source for both components: `code-output.component.ts:152` and `tool-input-display.component.ts:239`.
- The text helpers live once in `utils/tool-text.utils.ts`. Grep over `libs/frontend` finds a single definition of each: `stripSystemReminders`, `stripAnsiCodes`, `toolOutputPlainText`, `exceedsWrappedRows`, `outputShowsError`.
- The retention sentence is built once in `toolRetentionMessage` (`tool-text.utils.ts:64-82`). Both consumers call it: `tool-input-display.component.ts:265-267` and `tool-output-display.component.ts:107-109`.
- The wrapped-row estimate has one definition (`tool-text.utils.ts:48-56`). It strips the trailing line terminator itself, so the two pipelines can no longer drift.
(The only other definitions of these helper names sit in `libs/backend/cli-agent-runtime/.../cli-adapter.utils.ts`, outside this diff and not importable by chat-ui.)

**3. Diff header counts contrast — FIXED.**
`diff-display.component.ts:61-68` renders the numbers in `text-base-content`. The `text-error` / `text-success` colour now sits only on the sign glyphs, which are `aria-hidden`. The `sr-only` counts sentence at line 69 keeps the numbers readable. The comment at lines 59-60 states the rule.

**4. Failing `as ExecutionNode` cast in the spec — FIXED.**
`code-output.component.spec.ts:12-23` has one `node(partial)` factory. It includes `isCollapsed: false`. The file has no `as ExecutionNode` left, and the single factory serves all three describes (lines 29, 132, 481).

**5. Unjustified deviations from the chosen design — FIXED.**
Each deviation is now implemented or recorded in one docblock line:
- Short plain-text output gets no label row, only a floating Copy: `code-output.component.ts:214-216` and template lines 102-111. Pinned by `code-output.component.spec.ts:216-251`.
- The `started` word for a completed background command: `tool-call-header.component.ts:152-158` and `300-305`. Pinned by `tool-call-header.component.spec.ts:291-317`.
- MCP first argument in the body, not the header: recorded at `tool-call-header.component.ts:55-57`.
- `failed` instead of Direction A's `exit failed`, because `ExecutionNode` has no exit code: recorded at `tool-call-header.component.ts:66-67`.
- Ptah calls keep a status-coloured rail, not Direction C's gold rail: recorded at `tool-call-item.component.ts:39-41`.

**6. Duplicated stylesheet pins — FIXED.**
One pin remains: `code-output.component.spec.ts:516-519` reads the shared `tool-output-markdown.styles.ts`. The comment at lines 508-515 states both halves of the contract and why the pin exists. The `readFileSync` pin in `tool-input-display.component.spec.ts` is gone. Both components consume the identical shared array, so one pin covers them.

**7. `tool-input-display.component.ts` split — DEFERRED by agreement.**
The file is now 445 lines, down from 534. The Write-content preview remains the natural extraction. Not re-raised as blocking.

**8. `tool-target.utils.ts` split — DEFERRED by agreement.**
The naming group (`splitMcpToolName`, `isPtahMcpToolName`, `displayToolName`, `isJustToolName`) remains the clean seam for a next-touch split. Not re-raised as blocking.

**9. Dead todo exports — FIXED.**
`todo-list-display.component.ts` is now 93 lines with one export, the component. The deprecated `TodoWriteInput` alias and the `TodoItem` re-export are gone.

**10. Refactor-history narration — FIXED.**
`tool-call-item.component.ts:26` reads "One tool call as a quiet log line with a status rail". No "REFACTORED" and no line-count history remains.

## The new files, against repo conventions

- `utils/tool-status.utils.ts` — clean. `import type` for `ExecutionStatus`. Explicit return type `ToolStatusPresentation` on the public function. Existing tokens only (`bg-success`, `bg-error`, `bg-info`, `bg-warning`, `bg-base-300`). Reduced motion is honoured at line 48 (`motion-reduce:animate-none`). The switch at lines 33-58 covers all six values of the union at `libs/shared/src/lib/types/execution/node.ts:35-41`, so a seventh value fails compilation instead of falling through.
- `utils/tool-text.utils.ts` — clean. `import type` for the retention types. Explicit return types on every export. The `eslint-disable-next-line no-control-regex` at line 24 is justified by the ANSI pattern. No `as any`. The casts inside `extractMcpText` (lines 127, 132) are narrowing casts on already-checked shapes.
- `molecules/tool-execution/tool-output-markdown.styles.ts` — clean. One export constant. Every `::ng-deep` selector is scoped under `:host` and the component's own `.tool-output-markdown` subtree. The docblock at lines 1-15 justifies the rules and the `overflow: visible !important` lift. Body text stays at 11px. The two `!important` uses beat an inline style and a global stylesheet rule, as in round 0.
- Hard-coded colours: none. The `#000` values at `code-output.component.ts:142,147` and `tool-input-display.component.ts:229,234` are mask alphas in the fade gradient. A mask uses the alpha channel, so no colour renders. `diff-display.component.ts:121` uses the theme variable `--bc`.
- Barrels: minimal. `chat-ui/src/index.ts:132-135` exports `toolStatusPresentation` and its type because the chat lib needs them through the barrel (`tool-call-item.component.ts:17`). `tool-text.utils` and the shared styles stay internal, which is correct.

## New findings

**N1. `tool-status.utils.ts` has no direct spec.** — minor — `libs/frontend/chat-ui/src/lib/utils/tool-status.utils.ts:21`
Its three sibling util modules each have a spec (`tool-language.utils.spec.ts`, `tool-target.utils.spec.ts`, `tool-text.utils.spec.ts`). The mapping is covered indirectly: `tool-call-header.component.spec.ts:360-361,406-414` asserts the words, and `tool-call-item.component.spec.ts:28-32,78-81` asserts the rail classes. **Fix:** add `tool-status.utils.spec.ts` on the next touch, mirroring `tool-text.utils.spec.ts`.

**N2. Text-height math is split across two modules.** — minor — `libs/frontend/chat-ui/src/lib/utils/tool-target.utils.ts:235`
`countLines` lives here while `exceedsWrappedRows` (`tool-text.utils.ts:48`) lives in the new module. Both measure display height and are used together (`code-output.component.ts:186,206`, `tool-input-display.component.ts:349,359`). Each rule has one home, so this is a cohesion seam, not duplication. **Fix:** co-locate the two on the next touch.

## Test quality of the round-1 additions

`tool-text.utils.spec.ts` asserts behaviour, not implementation: MCP extraction, reminder and ANSI stripping, wrapped-row boundaries, error-message matching (equal, trailing, incidental, empty) and both retention sentences. The three named defects stay covered: repeat removal, header suppression (now one pin on the shared file) and the single scroller. The `started` word, the conditional header row and the permission-outranks-error rule all have direct tests.

## Recommendation

APPROVED. All four round-0 major findings are verified fixed at the cited lines, and the new files follow the repository conventions. N1 and N2 are next-touch items and do not block the branch. Findings 7 and 8 stay on the deferred list by agreement.