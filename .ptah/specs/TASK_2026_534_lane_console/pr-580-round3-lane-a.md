# PR #580 round 3 — compact session summary

## Finding: valid

The previous `markFailedTurnProse` searched every collected prose item backwards without retaining a turn boundary. `summarizeFinalized` collected the entire message history, so a latest turn without assistant prose could reclassify the preceding successful response. Its gate also reused the status badge's error tone, which includes limits. Both parts of the finding are valid.

## Boundary and terminal evidence

- `libs/shared/src/lib/types/execution/agent.ts:90` exposes `ExecutionChatMessage.role`; `:100` exposes the nullable finalized tree. User messages need not have a tree. The last `role === 'user'` message is the available prompt boundary; there is no turn id on this input contract.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:144` passes `tab.messages` into `summarizeFinalized` when no live stream exists. This file was read only.
- `compact-session-summary.ts:107` tracks the collected-item offset of the latest user prompt BEFORE skipping null trees. It resets terminal time at each prompt and adjusts the offset when the 48-item retention cap removes older items (`:119`). This uses transcript order, not timestamp comparisons. If the supplied history has no user boundary, the supplied items remain one undivided turn, preserving assistant-only input compatibility.
- `libs/shared/src/lib/types/execution/node.ts:189` provides optional execution `endTime`. The latest finalized root supplies that terminal time (`compact-session-summary.ts:117`). The live `message_complete` branch already emits a terminal mark with its event timestamp (`:201`). There is no terminal timestamp in `CompactSummaryContext`.

## Explicit failure classification

The allowlist at `compact-session-summary.ts:296` is:

| Failure reason                      | Shared contract evidence                         |
| ----------------------------------- | ------------------------------------------------ |
| `prompt_too_long`                   | `libs/shared/src/lib/types/sdk-hook.types.ts:69` |
| `image_error`                       | `libs/shared/src/lib/types/sdk-hook.types.ts:70` |
| `model_error`                       | `libs/shared/src/lib/types/sdk-hook.types.ts:71` |
| `api_error`                         | `libs/shared/src/lib/types/sdk-hook.types.ts:72` |
| `malformed_tool_use_exhausted`      | `libs/shared/src/lib/types/sdk-hook.types.ts:73` |
| `tool_deferred_unavailable`         | `libs/shared/src/lib/types/sdk-hook.types.ts:79` |
| `structured_output_retry_exhausted` | `libs/shared/src/lib/types/sdk-hook.types.ts:83` |
| `turn_setup_failed`                 | `libs/shared/src/lib/types/sdk-hook.types.ts:84` |

These denote input/provider failures, unavailable deferred execution, exhausted recovery retries, or failed setup. Deliberate stops, deferrals, background requests, completion and resource limits are excluded. This is an explicit classification of the existing contract, not inference from badge color or message text.

All 19 contract reasons retain their existing status mapping (`compact-session-summary.ts:514`):

| Reasons                                                                        | Existing status text / tone | Re-tone prose?         |
| ------------------------------------------------------------------------------ | --------------------------- | ---------------------- |
| `completed`                                                                    | Finished / success          | No                     |
| `aborted_streaming`, `aborted_tools`                                           | Stopped / warning           | No                     |
| `blocking_limit`, `rapid_refill_breaker`, `max_turns`                          | Limit reached / error       | No                     |
| `budget_exhausted`                                                             | Needs attention / error     | No                     |
| `stop_hook_prevented`, `hook_stopped`, `tool_deferred`, `background_requested` | Needs attention / error     | No                     |
| The eight failure reasons above                                                | Needs attention / error     | Latest-turn prose only |

The four resource limits are `blocking_limit`, `rapid_refill_breaker`, `max_turns`, and `budget_exhausted` (`sdk-hook.types.ts:67`, `:68`, `:80`, `:82`). The contract contains no `max_budget` member; the installed SDK separately calls a result subtype `error_max_budget_usd` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5359`). No unsupported terminal string was added.

## Fix

`markFailedTurn` (`compact-session-summary.ts:307`) gates on that allowlist and searches only items after the latest boundary. When current-turn prose exists, only its newest item gains `tone: 'error'` and `contentKind: 'error'`; earlier-turn prose remains successful.

When no current-turn prose exists, it reuses an existing current-turn terminal mark (`:327`) or adds one. The row has `kind: 'terminal'`, `tone: 'error'`, and label/text from `terminalStatus`. Its timestamp is the finalized terminal time, otherwise an existing terminal event time, otherwise the maximum retained mark timestamp (zero for empty input). Finalized collection previously emitted no terminal mark; live collection already emits one for `message_complete`, so reuse avoids adding a duplicate.

The terminal item's error content and text make `selectContent` (`:454`) select the terminal failure for the recap instead of old prose. Its position at the end of the semantic list also prevents earlier tool errors from replacing this terminal recap. Existing question/permission priority is preserved. The existing feed counts error-toned marks (`compact-session-activity.component.ts:725`, `:730`), so the new fallback supplies one ERR row for the requested no-prose case.

## Specs

All references below are in `compact-session-summary.spec.ts`:

- `:232`: eight failure reasons, earlier successful prose, latest user boundary and current failure prose; exactly one error mark and error recap.
- `:281`: all eleven remaining reasons, including all four limits; normal final prose stays successful with no error mark.
- `:299`: earlier successful prose plus empty failed tree; one terminal error, terminal text recap, explicit end-time and newest-mark fallback cases. Repeated calls produce the same result without accumulating rows or mutating history.
- `:338`: 60 earlier prose items and a latest user prompt without a tree; boundary survives retention truncation, old visible prose stays successful, exactly one error row.
- `:370`: live completion terminal is reused, retaining its identity/time and producing the error recap.
- `:398`: failure with no stream or marks still produces a terminal error at timestamp zero.

## Stack and scope

Angular 22.1.7 and TypeScript 6.0.3 are declared in `package.json:93` and `:283`. The nearby activity and stats components use standalone OnPush components, signal inputs/computed state and existing Tailwind/daisyUI classes (`compact-session-activity.component.ts:702`, `:706`, `:725`; `compact-session-stats.component.ts:42`). This change stays in the existing pure summary function and Jest spec, with no markup, state API, token or shared primitive added. Markdown continues through the existing `MarkdownBlockComponent`. Scope boundaries remain those in `eslint.config.mjs:264` and the existing package-alias imports.

No batch/design handoff is present in this task folder. The explicit round-3 request owns this correction; the prior error-row rationale is superseded only where it assumed the latest prose necessarily belonged to the failed turn. No git commands were run. No source outside the assigned compact-session directory was edited.

## Verification

- `npx prettier --write` completed on both edited TypeScript files.
- Scoped `ptah_get_diagnostics` reported **zero diagnostics in the edited files**, but **six errors / zero warnings in untouched files**: `streaming-quotes.component.spec.ts:22`, `compact-session-activity.component.spec.ts:129`, and `libs/frontend/core/src/testing/mock-rpc-service.ts:53`, `:59`, `:65`, `:68`. These were not changed.
- Ran `npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat-ui --skip-nx-cache` with the requested last-30-lines output. After removing a newly reported non-null assertion warning, reran with `--output-style=static` to expose successful target summaries. Final results: **34/34 suites passed; 308/308 tests passed (22 additional cases); typecheck passed**. Lint remains failed with **1 error / 9 warnings**, all outside the edited files. The error is the explicitly accepted pre-existing `@angular-eslint/no-output-native` at `agent-card-output.component.ts:76`. The overall Nx run therefore reports failure only for lint; it is not an all-green quality gate. No new lint findings remain.
- No manual browser render was performed; this change affects summary data, with presentation exercised by the project's component tests.

## Files written

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-summary.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-summary.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\.ptah\specs\TASK_2026_534_lane_console\pr-580-round3-lane-a.md`

No source-scope deviations. Implementation and requested verification are finished; the accepted lint failure and unrelated diagnostic errors remain as recorded above.
