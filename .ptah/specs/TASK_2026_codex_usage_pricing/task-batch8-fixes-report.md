# Batch 8 review fixes

## Findings and changes

| Finding | Change |
| --- | --- |
| B1: structured cause unreachable | `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts:234` adds an optional, typed `limitReached` cause. `libs/backend/codex-runtime/src/lib/codex-event-translator.ts:113,209,404` recognizes the pinned native `turn.error.codexErrorInfo: "usageLimitExceeded"`, retains a validated `account/rateLimits/updated` snapshot, and attaches one safe cause to a failed terminal. `codex-chat-events.ts` already maps that field to the existing failure notice and result, so its transport and event shape did not change. The translator specs at lines 624 and 652 cover the native error, fallback and secret redaction. |
| Reset unit | `codex-event-translator.ts:108-122` accepts only bounded integer epoch seconds from an exhausted native `primary` or `secondary` rate window and converts them to milliseconds once. The spec at `codex-event-translator.spec.ts:624` asserts a 2030 UTC reset, guarding against a 1970 display. A turn error alone has no reset field in the pinned protocol; without a validated rate-limit update, the cause omits `resetsAt`. |
| Markdown table cells | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts:332` escapes ampersands, HTML brackets, backslashes, pipes and backticks, and folds line breaks in table cells. `agent-limit.formatter.spec.ts:331` covers provider text containing a pipe, backticks and a newline. |
| Remaining percent | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts:379` and `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tiles.ts:176` clamp to 0..100. Specs: `agent-limit.formatter.spec.ts:331` and `plan-limit-tile.component.spec.ts:89`. |

## Protocol evidence and limits

The pinned schema `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json:8572-8590,26197-26205` defines `CodexErrorInfo` with the string value `usageLimitExceeded` under `turn.error.codexErrorInfo`. Its `RateLimitWindow` definition at lines 18403-18426 has `usedPercent` and `resetsAt`; `libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:263-308` defines the `account/rateLimits/updated.rateLimits` envelope and `rateLimitReachedType`. The existing Codex plan usage reader (`libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.ts:12-13`) documents App Server `resetsAt` as epoch seconds. The pinned `turn.error` has no reset timestamp, so a reset is available here only when a matching exhausted rate window was observed in this translator instance. The latest notification may be absent or may not identify which limit bucket failed; no timestamp is invented in that case.

The requested `codex-chat-events.spec.ts` case driven directly through translator output remains unmet: `CodexEventTranslator` is private to `codex-runtime` and its public `src/index.ts` does not export it. A direct cross-project import would violate the public-alias rule, and editing `src/index.ts` is outside the permitted file list. The existing events spec still covers the safe message and unchanged failure shape with a typed fixture; the new translator spec covers the real native input and typed output. Exporting the translator from the `codex-runtime` public index would permit a direct combined spec in `agent-sdk`.

## Files changed

- `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts`
- `libs/backend/codex-runtime/src/lib/codex-event-translator.ts`
- `libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tiles.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.spec.ts`
- `.ptah/specs/TASK_2026_codex_usage_pricing/task-batch8-fixes-report.md`

Nx projects touched: `codex-runtime`, `vscode-lm-tools`, `chat-ui`. No tests, type checks, lint, builds, Nx or git commands were run, as instructed. Source and spec changes were inspected; LF and no BOM were confirmed for edited TypeScript files.

No rendered UI screenshot was inspected: this component has no standalone static artifact, and the task prohibited build and serve commands.
