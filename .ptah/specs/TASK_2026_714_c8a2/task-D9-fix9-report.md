# D9 fix 9 — completed native Codex child after Electron resume

## Root cause and live evidence

The restored cached-tab path received the native history but never replayed it. In an isolated Electron run, `chat:resume` returned **24 JSONL events** for the reopened session: one projected `agent_start` with `source: history`, a JSON-array item ID, `agentId`, `toolCallId`, and `parentToolUseId`; six child events carrying `parentToolUseId`; and two `tool_result` events. The session provider was `openai-codex`. Temporary renderer probes showed the cached-tab `refreshResumableSubagentsForSession` path received this reply, while `switchSession` and `SessionHistoryReplayer.replay` were never entered. The previous recovery code lived only inside `replay`, so no recovery warnings appeared and the new monitor and child execution stores stayed empty. The prior live result had a card without child output, an unavailable lane, and only Orchestrator in AGENTS.

## Fix

- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:364,575`: extracted the native completed-child recovery into `restoreNativeCompletedChildren`, called by full replay and reusable for a cached tab. It preserves the provider/projector marker gate, completed-result requirement, running-child protection, and idempotent store restoration.
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:1854`: after confirming the cached tab still owns the resumed session, passes the `chat:resume` events and provider ID to that recovery method. Parent messages remain in the cached tab; the call fills the fresh monitor and child execution stores.
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts:1273`: added a cached-tab RPC routing regression with synthetic events shaped like the live projected native events.
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.native-recovery.spec.ts:108`: added a regression using the real `AgentMonitorStore` and `SubagentExecutionStore`; it checks completed monitor state, the PINEAPPLE child tree, and idempotence.

Claude resumes remain gated out unless an event carries the native Codex history marker. Existing Claude-negative replay coverage remains in `session-history-replayer.service.spec.ts`.

## Verification

The allowed locked Electron build, WASM copy, and renderer copy all exited 0. The final live run used fresh copies of both databases and the original workspace path. Before and after one renderer reload and rail reselect, Playwright observed PINEAPPLE **inside the completed child card**, PINEAPPLE in the opened child lane with no unavailable notice, and a completed Codex child row alongside Orchestrator in AGENTS. Screenshots were inspected against the previous failed run; the card now visibly includes the child's output and the panel has two agents. See `live-test-d9-fix9.md`.

The new specs were written and parsed with Ptah AST analysis (zero error nodes for both spec files). They were **not run**, per the task's explicit no-tests/no-typecheck rule. The permitted build compiled the changed production source. `session-loader.service.ts` returned a recovered Tree-sitter parse (two error nodes in this large pre-existing file); the production build passed.

The initial global rollout count was 100 and the final count was 101; the additional `turn_context` was timestamped **before** the fresh final Electron launch, during this coding session. There was no new `turn_context` during the final app run, and no chat message was sent. The strict whole-task 0-delta counter could not be met because the coding session itself advanced it; the app-run window had delta 0.

`~/.ptah/settings.json` was restored from its backup and `cmp` returned 0. Only the Electron tree launched for this run was terminated. No npm install, Jest, lint, typecheck, general verify target, or git command was run.

## Files changed

In W (`D:\projects\ptah-extension\.claude-worktrees\codex-removal-a`):

- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.native-recovery.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/task-D9-fix9-report.md`
- `.ptah/specs/TASK_2026_714_c8a2/live-test-d9-fix9.md`

In L (`D:\projects\ptah-extension\.claude-worktrees\d9-live`), the only source files touched were `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts` and `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`. Both were first instrumented for diagnosis, then overwritten from W. Their final hashes match W and no temporary debug markers remain. Locked builds also regenerated L's `dist/apps/ptah-electron` output and Nx build artifacts. Evidence, DB copies, and helper scripts stayed under the two temporary evidence folders, outside either repository.
