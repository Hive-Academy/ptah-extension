# Batch 9a — gateway adapter and approval sink

Implemented the four assigned files and declared the permitted runtime dependency. Codex gateway production routing remains disabled. No index export, bridge integration, gateway profile, registration, task state, other lane source, or git operation was changed.

## Files

Root W = `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`.

- `W/libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.ts` — new context adapter and per-turn event projection.
- `W/libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts` — new adapter regression suite.
- `W/libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.ts` — new explicit approval presentation port and sink.
- `W/libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.spec.ts` — new approval regression suite.
- `W/libs/backend/gateway-chat-bridge/package.json` — added `@ptah-extension/codex-runtime: 0.0.1`.
- `W/.ptah/specs/TASK_2026_714_c8a2/batch-9a-report.md` — this deliverable.

All source references below are relative to `libs/backend/gateway-chat-bridge/src/lib/` unless stated otherwise.

## Contracts, boundaries and composition

Batch 9a in `batches.md:866` assigns new files only; the index export and bridge/profile wiring belong to 9b. C1/C4/C5 override the older plan's edited-input and MCP assumptions. The implementation uses only the public `@ptah-extension/codex-runtime` barrel. Both project.json files declare `scope:extension` and `type:feature`; root `eslint.config.mjs:294` permits extension-to-extension imports and the feature constraint permits feature-to-feature imports. Scoped lint confirms the edge is allowed.

Existing gateway behavior was checked in `gateway-chat-bridge.ts:335` (approval notices), `:879` (permission defaults), and `:890` (stream pump). The pump appends only `text_delta`; other flat events retain metadata without becoming chat text. Root CLAUDE.md and CONTRIBUTING.md supply repository conventions; no applicable nested instruction file was found. Existing bridge and conversation-queue specs supply the Jest conventions.

`codex-gateway-adapter.ts:19` uses the real public parity gate. `:46` rejects a missing sink or a disabled gateway gate before subscription/start; steer also checks admission. The real-gate regression confirms production cannot start a turn. Projection tests substitute the gate only in Jest; they are not rollout evidence.

For 9b, composition must obtain the runtime through `resolveGatedCodexRuntime`, open/resume the exact native identity, and pass the same ApprovalSink registered with that runtime into this adapter. The adapter accepts an existing CodexContext; it does not resolve containers, open processes, persist identities, build SDK requests, choose policy, or retry through the SDK. The additional adapter admission check cannot enable the currently disabled gate. `startTurn` returns an AsyncIterable; `steer` forwards an ordinary follow-up to the context (the active stream observes its events). Interrupt and close delegate to that exact context (`:28`, `:33`, `:38`, `:42`).

## Event → gateway message mapping

| Core event                        | Flat stream / gateway behavior                                                                                                      | Evidence       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| textDelta                         | text_delta; ordered outbound text                                                                                                   | adapter.ts:122 |
| textFinal                         | Emits only the unstreamed suffix; final-only items emit their full text; repeated finals do not duplicate output                    | adapter.ts:134 |
| reasoning                         | thinking_delta with per-item delta/final deduplication; never chat text                                                             | adapter.ts:144 |
| toolStarted                       | tool_start with stable toolCallId, toolName, object input                                                                           | adapter.ts:160 |
| toolCompleted                     | tool_result with stable toolCallId, output, failed/cancelled isError                                                                | adapter.ts:175 |
| usage                             | message_delta only when both input/output counters were reported; retain reported usage for completion                              | adapter.ts:184 |
| error                             | Throw the core-sanitized message; no fallback or invented completion                                                                | adapter.ts:199 |
| terminal completed/interrupted    | Exactly one message_complete; stop at terminal without waiting for process exit; preserve reported cost and complete token counters | adapter.ts:201 |
| terminal failed                   | Throw the core-sanitized error, or a fixed safe failure message                                                                     | adapter.ts:201 |
| file/image/compaction             | No invented outbound text, attachments, or compaction token measurements                                                            | adapter.ts:219 |
| approvalRequested/approvalSettled | No authorization from event projection; decisions flow exclusively through the core-owned sink invocation                           | adapter.ts:222 |

In this table, `adapter.ts` means `codex-gateway-adapter.ts`. Event IDs include context/generation/sequence; sessionId is the native thread and messageId includes thread/turn. `:55` subscribes before startTurn, filters unrelated context/generation/thread/turn events, and releases subscriptions/listeners in finally. A missing terminal is an error. Failed start, input abort and early consumer return close abandoned context work. Normal terminal completion leaves the context reusable. Cleanup failures log only fixed messages through the injected Logger port.

The gateway's append-only boundary cannot replace already-sent text if a final snapshot contradicts preceding deltas; the projection does not append a contradictory duplicate. No new attachment, compaction, or question UI is claimed. These limitations do not constitute native parity and do not open the gate.

## Approval UX and timeout/cancel behavior

- `codex-gateway-approval-sink.ts:8`: offered decisions are exactly accept, acceptForSession, decline, cancel. No edited-input choice or unrestricted Always Allow.
- `:12`: composition supplies a conversation-bound presentation with notice delivery, optional authenticated prompt routing, and correlated dismissal. Full core correlation accompanies the request; core remains the authority for stale replies and session rules.
- `:31`: an already-aborted request returns cancel without presenting. Missing routing declines immediately, as does userInput that this four-decision surface cannot answer. This refusal is not question/plan parity.
- `:43`: notice describes the four decisions and instructs the user to decline then send a follow-up to edit. Notice delivery is best-effort and is never interpreted as approval.
- `:52`: race presentation against the core abort signal. Core owns the timeout; there is no duplicate sink deadline or per-item timer. On timeout/disposal abort, resolve cancel, remove the abort listener, and dismiss the correlated prompt (`:80`). The notice explains that the action was not approved.
- `:60`: abort wins over a concurrently arriving acceptance. A late acceptance cannot change the settled result.
- `:68`: editedInput/modifiedInput/updatedInput replies return `{ decision: 'decline', editNotSupported: true }`; the original action never receives acceptance from that reply. A later ordinary message uses the adapter's steer operation. Arbitrary malformed replies decline.
- `:77`: presentation failures decline (or cancel after abort). Notice/dismissal failures log fixed sanitized messages. They never produce acceptance.
- MCP requests use the core's `mcpElicitation` request kind through the same port. No protocol parsing or `_meta.persist` is implemented here.

## Spec list

`codex-gateway-adapter.spec.ts` (17 cases): real parity gate disabled; missing sink; subscribe-before-start/order/final-only/one terminal; duplicate-final suppression; tool/reasoning/usage mapping; absent usage counters; stale identity isolation; non-text events; error/failed-terminal/empty-stream failures; early consumer return; failed-start cleanup; steer/interrupt/close forwarding; pre-aborted input; active input abort; interrupted completion. Representative cases: `:80`, `:108`, `:141`, `:204`, `:243`, `:266`, `:309`, `:327`.

`codex-gateway-approval-sink.spec.ts` (18 cases): all four decisions; unroutable notice never approves; MCP elicitation; three edited-input reply shapes; four malformed replies; unanswered/core-abort cleanup and late acceptance; pre-abort; presentation/dismissal errors without secrets; failed notice; unsupported user input. Representative cases: `:42`, `:58`, `:71`, `:78`, `:92`, `:103`, `:133`, `:153`.

## Exact verification

Commands were run from W in PowerShell; Select-Object/Select-String are the shell equivalents of the requested tail/grep filters. No build, install, workspace-wide test, e2e, real model turn, or git command ran.

1. `npx prettier --write libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.ts libs/backend/gateway-chat-bridge/src/lib/codex-gateway-approval-sink.spec.ts libs/backend/gateway-chat-bridge/package.json` — passed.
2. `ptah_get_diagnostics` scoped to the two new production source files — final result: 0 errors, 0 warnings, clean coverage. Initial diagnostics caught two TS2322 errors (readonly JSON narrowing and callback return inference); both were fixed. The initial Jest attempt stopped at these same compilation errors before running tests.
3. `npx jest -c libs/backend/gateway-chat-bridge/jest.config.ts codex-gateway-adapter.spec.ts codex-gateway-approval-sink.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20` — final result: 2 suites passed, 35 tests passed, 0 snapshots; 4.398 seconds. Node prints a config-loading ES-module warning before Jest succeeds.
4. `npx nx run-many -t typecheck lint -p @ptah-extension/gateway-chat-bridge --parallel=1 --output-style=static 2>&1 | Select-String -Pattern 'problems|Successfully|Failed| error |warning ' | Select-Object -Last 10` — typecheck/lint passed, 0 errors, 3 warnings. A rerun after the two added lifecycle specs found one no-unexpected-multiline error in the new cancellation test; splitting the stream and iterator declarations fixed it. The three pre-existing gateway-chat-bridge.ts warnings are no-useless-assignment at lines 281 and 709 and max-lines at line 1059. Final confirmation after that test-only fix passed: Successfully ran targets typecheck, lint for project @ptah-extension/gateway-chat-bridge; 0 errors and the same 3 existing warnings.
5. `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String -Pattern 'gateway-chat-bridge|TOTAL'` — `libs/backend/gateway-chat-bridge: 4 ok (baseline 4)`; `TOTAL 276 unsuppressed site(s)`. No gateway FAIL; all four listed gateway sites are in the existing gateway-chat-bridge.ts.

## Decisions

| Decision                                                                          | Options considered                                           | Evidence                                                                                                  | Reversible                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Existing CodexContext injected; no runtime construction in adapter                | Own process/runtime vs consume core context                  | Batch 9a thin projection; plan §8 and public context contract                                             | Yes, composition remains 9b-owned      |
| Check real parity gate before both start and steer                                | Trust caller alone vs defense at consumer admission          | User requires disabled gateway; public gate is false for every platform today                             | Yes, gate remains core-owned           |
| Constructor-injected narrow Logger port                                           | Console logging vs repository Logger                         | Existing gateway bridge Logger and user instruction                                                       | Yes                                    |
| Conversation-bound presentation port, no Slack/Discord/Telegram integration in 9a | Direct platform calls vs explicit presentation seam          | Batch excludes 9b integration; existing gateway uses notices plus a separate approval surface             | Yes                                    |
| Core owns timeout; sink reacts to abort and dismisses prompt                      | Duplicate gateway timeout vs shared core deadline            | Plan §6 and ApprovalSink contract; batch-2g lifecycle                                                     | Yes                                    |
| Decline edited-input replies; follow-up goes through steer                        | Mutate pending tool vs decline and ordinary message          | Settled C1/C5 and runtime public decisions                                                                | Yes, only if approved contract changes |
| Omit events lacking a truthful flat/gateway representation                        | Fabricate counts/messages vs preserve current text-only pump | gateway-chat-bridge.ts:890; shared stream requires compaction measurements; no attachment channel in pump | Yes, future reviewed surface changes   |
| Declare codex-runtime package dependency                                          | Implicit path-only edge vs explicit dependency               | New public barrel import; Nx dependency lint                                                              | Yes                                    |

## Outstanding / handoff

- 9b must wire/export the adapter and sink, bind authenticated prompt routes and the same sink into runtime composition, and preserve exact native resume. No user routing changes were made here.
- PR #808's package.json diff could not be checked: gh is unavailable, as stated in the assignment. The permitted gateway package dependency was added; the coordinator must check overlap before integration.
- No live Slack/Discord/Telegram or App Server approval interaction was run. Unit coverage is not permission or rollout parity. The production parity gate remains disabled.
