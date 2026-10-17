# Lane report — TASK_2026_632_a6b1

## Files changed

- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-stop-notices.ts` — new session-scoped stop-notice store.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-handoff-message.ts` — reason-specific notice builder.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts` — record notice before dispatching a stop and forget it on release.
- `libs/backend/agent-sdk/src/lib/message-transform/transformer-helpers.ts` — expose the notice store to system-message transformation.
- `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.ts` — replace the summary only for a matching stopped task notification.
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` and `libs/backend/agent-sdk/src/lib/di/register.ts` — register one notice-store singleton and inject it into the monitor.
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts` — inject the same singleton into transformer helpers.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.spec.ts` — handoff, safety, release, and exhausted-stop coverage.
- `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.spec.ts` — monitor stop and genuine user stop coverage.
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` — child-facing transcript regression coverage.
- `libs/backend/agent-sdk/src/lib/di/register.compaction-boundary-registry.smoke.spec.ts` — singleton and transformer resolution guard.

## Design

`SubagentBudgetMonitor` records a task-specific Ptah notice immediately before `stopSubagent`. Handoff notices use context tokens and the handoff limit; safety notices use weighted tokens and the safety limit. Both explain that the user did not stop the agent and that a fresh agent can continue from a handoff. The record survives rejected stop attempts, including exhausted retries, because the SDK may still have stopped the agent. `release()` removes that session's records. The existing parent handoff message is unchanged.

The `SubagentStopNotices` class is the small host-neutral port shared through agent-sdk DI. `buildAgentCompleted` uses a recorded notice only when the notification status is `stopped` and its task ID matches. All other summaries, including genuine user stops, retain the SDK text. The transformer constructor accepts this injected dependency optionally to preserve existing direct construction outside the agent-sdk DI container; production registration supplies it.

## Child-session finding

`ptah_session_read` reaches `SessionSpawnerService.read()` in `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:641-707`, which reads text through the transcript adapter at `:673`. `libs/backend/agent-sdk/src/lib/sdk-transcript-reader.adapter.ts:31-39` obtains projected history and joins role/content. `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:633` removes raw `<task-notification>` content, so the SDK's generic `stopped by user` notification is absent from child-facing transcript text. The updated history-reader regression test uses that exact raw notification and checks it is absent from the projection. `ptah_session_status` formats status metadata in `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts:134-172,250-268`; it does not consume the SDK summary. The `agent_completed` summary fix covers the parent/UI stream.

## Checks

- `npx prettier --write` on the 12 changed source/spec files: passed.
- Focused Jest command for monitor, transformer, history reader, and DI smoke specs with `--coverage=false --maxWorkers=2`: exit 1; 3 suites passed, 1 failed, 198 tests passed. The DI smoke suite could not load `node_modules/marked/lib/marked.umd.js` through the worktree Jest mapping. The file is absent in this worktree and exists in the repository's parent `node_modules`.
- `npx nx run-many -t typecheck,lint,test -p agent-sdk --parallel=1`: exit 1; agent-sdk typecheck and lint passed; Jest reported 158 suites passed, 5 failed, 2 skipped, with 3407 tests passed, 3 failed, 3 skipped. The captured output identified missing `marked` as a suite-load cause; the three failed test details were outside the filtered output. Nx Cloud also reported a 401 warning, but local targets ran.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.spec.ts --coverage=false --maxWorkers=2`: passed, 88 tests in 1 suite.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/sdk-message-transformer.spec.ts --coverage=false --maxWorkers=2`: passed, 17 tests in 1 suite.
- `npx nx typecheck agent-sdk --parallel=1` after the final edits: passed.
- Final `ptah_get_diagnostics` found no errors in the requested changed files. It also returned three errors in unchanged `helpers/session-lifecycle/session-query-executor.service.spec.ts:1022,1568,1729` (`TS2554`, 7 arguments supplied where 9 are expected); the Nx typecheck target excludes these spec diagnostics.

## Decisions

- Kept the notice store as a concrete, small class with task ID lookup and session cleanup. This follows the existing singleton DI pattern and is reversible without changing the stream event contract.
- Kept the transformer constructor's new parameter optional because `auth-providers` directly constructs `SdkMessageTransformer` in an existing spec. The registered production path always injects the singleton; making the parameter mandatory would break that public construction. This is reversible when all direct callers can supply the dependency.
- Left child-session production code unchanged because its transcript projection already excludes raw task notifications and status does not use their summary. The regression test documents that behavior.

## Limitations

The full agent-sdk Jest target is not green in this worktree. The DI smoke suite is blocked by the missing `marked` path; three other failed test details were not captured in the filtered output. No workspace-wide, build, serve, dev, e2e, or package target was run.
