# TASK_2026_UI_DEFECTS verification report

## Fixes

- Code — `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:174`: moved `finiteToken` above `@Component`. It had been inserted between the decorator and `ChatViewComponent`, where TypeScript reports TS1206 because a decorator must immediately precede the class.
- Code — `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-tests-row.component.ts:20,174`: retained `TurnTestRun.project` in the rendered row. The template correctly displays `row.project ?? row.command`; the view model had accidentally discarded `project`.
- Code — `libs/frontend/chat/src/lib/settings/ptah-ai/cli-model-effort-popover.component.ts:500` and `cli-matrix-rows.ts:114`: constrained Ptah CLI instance effort/undo values to `'' | PtahCliReasoningEffort`, the RPC update contract. This resolves TS2322/TS2345 without casting.
- Spec — `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.spec.ts:16,47`: updated stale prompt expectations after the intended verification-guidance expansion. The actual prompt is 4,041 tokens, within the revised 4,100-token ceiling, and intentionally says `Verify only changed projects:`.
- Spec confirmation — the updated provider-API reset expectations in `window-state.spec.ts` and `lane-state.spec.ts` are correct per `analytics-quota-report.md`; shared passed 106 suites / 2,985 tests.

## Scoped verification

All commands used `--parallel=1`; tests also used `--maxWorkers=2`.

| Project           | Typecheck                           | Test                                                                                                                  |
| ----------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| shared            | PASS                                | PASS — 106 suites, 2,985 tests                                                                                        |
| agent-sdk         | PASS                                | PASS — 150 suites passed (2 skipped), 3,173 tests passed (3 skipped)                                                  |
| auth-providers    | PASS                                | FAIL — 60 suites passed / 1 failed; 1,542 tests passed / 4 failed                                                     |
| cli-agent-runtime | PASS                                | FAIL — Nx test exited 1; the filtered sequential command retained only the failure exit, not the Jest failure details |
| rpc-handlers      | PASS                                | PASS — count not retained in filtered command output                                                                  |
| chat-state        | PASS                                | PASS — count not retained in filtered command output                                                                  |
| chat-streaming    | PASS                                | PASS — count not retained in filtered command output                                                                  |
| core              | PASS                                | PASS — count not retained in filtered command output                                                                  |
| ui                | PASS                                | PASS — count not retained in filtered command output                                                                  |
| dashboard         | PASS                                | PASS — count not retained in filtered command output                                                                  |
| chat-ui           | PASS                                | PASS — count not retained in filtered command output                                                                  |
| chat              | PASS (one unrelated NG8107 warning) | PASS — 178 suites, 3,246 tests (2 skipped)                                                                            |

## Left untouched

- `auth-providers` fails only in `translation-proxy.sdk.integration.spec.ts`: four tests complete their assertions but teardown cannot remove Windows temporary scenario directories (`EPERM` at `removeTree`, line 177). This is an environmental file-handle cleanup failure, unrelated to the TASK UI changes; no source/spec in that area is modified in this worktree.
- The pre-requested agent-sdk handoff-writer and subagent-message-dispatcher failures were not present in the final run. `git diff --` for both named spec files was empty before verification, so no unrelated change was made.
- `cli-agent-runtime` remains red. Its test command exit was captured but the deliberately tailed sequential command did not retain diagnostic lines; it was not rerun solely to reread output, per the task constraint.

Nx Cloud printed an organization-plan warning for each command; it did not affect the successful target results.
