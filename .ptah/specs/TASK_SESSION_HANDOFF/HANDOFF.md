# Handoff — session hand-over workflow (breakpoint 1)

Branch `fix/session-handoff-workflow`, worktree `D:\projects\ptah-extension\.claude-worktrees\session-handoff-workflow`, based on `origin/main` 816fd108c. Not pushed. No PR yet.

## User requirements (final — the user will not change them again)

1. Hand-over starts only after a message turn has finished (SDK `result`, or a successful interrupt release). Never mid-turn.
2. **Automatic, like auto-compact.** At the `handoff` budget stage (`handoffPercent` of the configured limit = **40M tokens** with defaults 50M × 80%, or after `handoffAfterCompactions`) the coordinator arms by itself at turn end, Ptah sends the agent an owned "write your handoff" prompt, the agent's answer becomes the handoff (fallback: deterministic builder), a successor session starts seeded with it, the webview binds + focuses it, the held FIFO is delivered once in order, then the source closes.
3. **One 40M message.** No banner at `tighten` or for the rotation advisory. One message at `handoff`; `limit` and hand-over progress/failure update the same message in place. Cancel (keep working) stops the automatic flow; no re-arm until `limit`; at `limit` it asks "Continue now".
4. One flow per session. No input is lost: queued composer text, lane completions, agent reports, peer messages and steer text are held and delivered to the successor or restored.
5. Successor (hand-over) mode for `ptah_session_start`: any session can start its successor; top-level successor has no parent link; a child's successor inherits the closing child's parent and worktree/MCP-root lease; source ends after the successor confirms; depth limit stays only for real nested children.
6. The successor runs in the source's permission mode (full auto stays full auto). Recommended: inherit, not force. Needs a test (see Next steps).
7. Finish with a PR. The user authorized push + PR for this branch. Do not merge.

## Done (breakpoint 1 commit)

| Area | State |
| --- | --- |
| Batch A — `SessionHandoverCoordinator` (agent-sdk), pump admission gate, terminal + interrupt arm before `markTurnEnded`, source-neutral FIFO, builder boundary handling, DI | Done, reviewed (Glm, same-family codex), fixed |
| Batch B — host adapter `startSuccessorSession` (seed → bind/focus ack 15 s → final FIFO → close), `session:beginHandover` / `cancelHandover` / `getHandoverState` / `successorBound`, `chat:continue` admission before Ptah CLI + budget refusal, stop-intent hold | Done, reviewed, fixed |
| Round 2 — FIFO exactly once after bind, `sourceEnded` for exits without `result`, late-webview state replay, `budget-auto` arm, owned handoff turn replaces `/compact` | Done, reviewed (antigravity), fixed in round 3 |
| Round 3 — `complete()` re-checks phase after every await, no auto re-arm after cancel/failure, bounded `lostInputTexts` + "Put back in composer", multi-message handoff capture, missing tests | Done |
| Batch C — banner only after terminal `turn_state`, one owner view, queue flush at turn end (clear before await, restore once), successor bind/focus/ack, 40M single message, auto-progress UI, 9 restored banner tests | Done, reviewed (antigravity), fixed |

Verification at this breakpoint (run by the orchestrator, scoped):

- agent-sdk Jest: 21 suites, 697 tests pass. rpc-handlers Jest: 25 suites, 374 pass. chat Jest: 52 suites, 1031 pass. chat-streaming Jest: 24 suites, 585 pass.
- typecheck pass: agent-sdk, rpc-handlers, shared, cli-agent-runtime, chat, chat-streaming.
- lint 0 errors: agent-sdk, rpc-handlers, shared, cli-agent-runtime, chat, chat-streaming (warnings pre-exist).

## Next steps (in order)

1. **Batch D (codex)** — plan section `### D.` in `implementation-plan.md`: `ptah_session_start` strict `mode: "successor"` (`session-tool-args.schema.ts`, `session-tools.ts`, `session-tool-handlers.ts` in vscode-lm-tools), spawner child/successor union, `depth-exceeded` only for `mode: "child"`, successor delegates to the coordinator. Also:
   - Review AB finding 4: snapshot hard-codes `inheritedParentIds: []` and no `mcpRootPath` (`session-lifecycle-manager.ts` ~456-476); child successor must inherit parent ids + worktree/MCP-root lease; source close must not `releaseMcpRoot` that path (`session-spawner.service.ts` ~1278-1288, 936-942).
   - Review A finding 11: `ptah_session_send` steer during a hand-over returns `interrupt-failed`; must hold the text and return `SESSION_HANDOVER_HELD` (`session-spawner.service.ts` ~585-596).
   - Test: full-auto source → full-auto successor (permissionLevel copied end to end).
2. **Final cross-family review** (antigravity) of the whole diff; one fix round at most (revise cap).
3. **Final scoped checks** for every changed project (commands below).
4. **Push + PR** (`gh pr create`), title under 70 chars, `## Summary` + `## Test plan`.

## Lane notes

- `grok`, `Glm` (Ollama Cloud) and `opencode` had no usage left. Use `codex` to implement and `antigravity` to review.
- `antigravity` needs `model: "gemini-3.1-pro-high"` + `effort: "high"` on every spawn. The configured default `claude-sonnet-4-6` is not in `agy models` and any mismatched `--effort` fails in 3 s.
- Codex lanes take queued messages only after their first completion signal; check `ptah_agent_status` before you treat a lane as done, and never start a second writer while a queued turn can still run.
- Codex lanes may spawn their own sub-lanes; their signals arrive here.
- The worktree has a `node_modules` junction to the main checkout (git-ignored). Without it rpc-handlers Jest cannot resolve `marked`.
- Lane claims of "pre-existing failure" were wrong twice. Check them.

## Verification commands (memory-safe; one at a time)

```
npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff libs/backend/agent-sdk/src/lib/helpers/session-lifecycle libs/backend/agent-sdk/src/lib/helpers/session-budget libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts libs/backend/agent-sdk/src/lib/di --coverage=false --maxWorkers=2
npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/handlers/session-budget-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts libs/backend/rpc-handlers/src/lib/chat --coverage=false --maxWorkers=2
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/notifications libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts libs/frontend/chat/src/lib/services --coverage=false --maxWorkers=2
npx jest -c libs/frontend/chat-streaming/jest.config.ts libs/frontend/chat-streaming/src/lib --coverage=false --maxWorkers=2
npx nx typecheck <project> --parallel=1   # agent-sdk rpc-handlers shared cli-agent-runtime chat chat-streaming (+ vscode-lm-tools after D)
npx nx lint <project> --parallel=1
```

## Key files

- Plan: `implementation-plan.md` (+ `implementation-plan-review*.md`). Defect trace: `defect-trace.md`. Flow diagrams: `handover-flow.html`.
- Reports: `batch-A/B/C-report.md`, `fix-round-1/2/3-report.md`. Reviews: `code-logic-review-A.md`, `-AB.md`, `-R2.md`, `-C.md`.
- Coordinator: `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts`.
- Host adapter: `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts`.
- Frontend: `libs/frontend/chat/src/lib/services/session-handover-client.service.ts`, `session-budget-banner.component.ts`, `chat-store/message-dispatch.service.ts`.
