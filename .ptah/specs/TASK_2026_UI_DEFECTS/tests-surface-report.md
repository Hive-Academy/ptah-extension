# Tests surface report

## Root cause

`libs/shared/src/lib/utils/turn-tests.utils.ts:26` previously returned `unknown` immediately for every Bash node with `run_in_background: true`. The later SDK `task_notification` for a `local_bash` task was then discarded in `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.ts` (the former non-agent early return, now replaced at line 631), so the execution tree could never update that original Bash node.

## Fix

- Background test commands now show `running` until their Bash node receives a terminal result; completed/error nodes resolve passed/failed as usual (`turn-tests.utils.ts:8-78`). Nx/Jest output is parsed for `Successfully ran target`, failed-target markers, `Failed tasks:`, `Tests:` and `Test Suites:`; discovered target rows and failure names are exposed separately.
- A `local_bash` `task_notification` now emits a keyed `tool_result` with its summary/output-file and terminal error state (`system-message.transformer.ts:631-644`). `AgentMonitorTreeBuilder` carries that result's `isError` onto the corresponding execution node (`agent-monitor-tree-builder.service.ts:692-696`).
- The Tests UI is now a bordered `cs-card` disclosure matching the change-set card (`turn-tests-row.component.ts:67`): header counts, status icons/labels, project-or-command rows, collapsed monospace commands, and parsed failures.
- Regressions added/updated in `turn-tests.utils.spec.ts:69,117` and `system-message.transformer.spec.ts:857,1179`.

## Verification-instruction text

- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:83` — changed-project tests only; no wide build/serve/dev/e2e without request; Nx/Jest concurrency caps; one foreground heavy run.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:419` — the same short rule for every CLI lane built by `buildTaskPrompt`.
- `.claude/skills/agent-lanes/SKILL.md:185-187` — scoped checks, no wide commands, caps and one heavy run at a time.

## Verification

- PASS: `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/utils/turn-tests.utils.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-pipeline.spec.ts libs/shared/src/lib/utils/turn-sources.utils.spec.ts --coverage=false --maxWorkers=2` — 4 suites / 84 tests passed.
- PASS: focused ESLint invocation over the edited TypeScript files exited 0 before the final test expectation adjustment.
- FIXED AFTER OBSERVED FAILURE: chat-ui row test initially expected the raw command in its visible field; the field now correctly retains that command while project rows use their target label.
- NOT CONCLUSIVELY REPORTED: final focused chat-ui and agent-sdk Jest invocations did not return a completion summary from the runner within the command tool window. No build, serve, e2e, Nx run-many, or workspace-wide check was run.

## Decisions

- Reused the change-set card's visual shell conventions/classes rather than importing chat-orchestrator code into `chat-ui`.
- Used the existing `tool_result` join as the background-completion transport; this avoids a second frontend store, timer, or polling path.
- The SDK notification supplies a summary and output-file path, not the file contents. Per-project Nx detail appears when that summary/output already contains target lines; reading arbitrary output files in the renderer was intentionally not added.

## Not done

- `ptah_agent_report` is not available in this spawned environment, so it could not be called.
- There is no rendered-browser screenshot in this environment; the focused component test is the available UI evidence.
