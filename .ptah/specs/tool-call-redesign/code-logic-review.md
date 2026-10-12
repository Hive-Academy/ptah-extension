# Code logic re-review — round 2

**Score: 8/10. Verdict: REVISE.** The four round-1 failure scenarios are fixed. The markdown safeguard introduces one major duplication in a common error case.

## Prior defects

1. **FIXED — error lost after markdown sanitization.** `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts:130-140` keeps a separate Error block whenever `detectToolLanguage(node)` is `markdown`, so a matching string removed by the markdown sanitizer no longer hides the error. The broader one-fact-once requirement has a new regression below.
2. **FIXED — background launch announced as command success.** `libs/frontend/chat-ui/src/lib/utils/tool-status.utils.ts:40-53` says `Command started` for a completed background command, retaining the success rail for the launch. `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.ts:291-314` feeds both the spoken status and visible `started` word from one background flag, with permission taking precedence.
3. **FIXED — pending permission output styled as failure.** `libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts:99-102` forwards the permission state through `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts:65-69,109`. `code-output.component.ts:175-187` uses the shared status mapping, so error status during a pending permission does not produce failure styling or an Error label.
4. **FIXED — short failed output region lacked failure text.** `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts:242-245` adds `, failed` to the focusable region's accessible name when the shared presentation marks the call as failed.

## New defects

1. **Major — ordinary markdown errors appear twice.** `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts:135-140` always keeps a separate Error block for markdown, even when markdown renders the exact error text visibly. For an MCP call with `toolOutput = 'File not found'` and `error = 'File not found'`, `ptah-code-output` displays that sentence and the separate Error block repeats it. The same occurs for a `Read` of a `.md` file; the test at `tool-output-display.component.spec.ts:413-423` explicitly expects the extra block. This violates the required one-place-per-fact behavior and the error deduplication criterion. Suppress the separate block when the markdown output is a safely visible plain-text match; retain it when markdown parsing or sanitization might remove the text.

## Decisions

- No other new blocking or major defect was found in the four round-1 fix paths. This was a read-only source and targeted-test review; no build, e2e, workspace-wide check, or new test run was performed.
