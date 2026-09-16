# TASK_2026_410 — Background agent execution visibility

## Request and status
User requested clickable background-agent execution showing live text, tool calls/results, and output after parent turn completion. GLM and MiniMax investigations completed; no implementation yet. User now authorized filing task, worktree creation and orchestration. Architecture review precedes implementation. No commit/push or stash restoration authorized.

Task filed through host as TASK_2026_410, BUGFIX, in_progress, related to TASK_2026_376. Host carrier is in original workspace. Session isolation prohibits writing reports there, so working deliverables belong in this worktree task folder; do not create a second task ID. Carrier visibility across host/worktree needs reconciliation through supported tooling.

## Workspace
Worktree: D:/projects/ptah-extension/.claude-worktrees/task-410-background-agent-execution
Branch: fix/task-410-background-agent-execution
Base: origin/main at 712478de8. Tool initially inherited local-production HEAD 01155ae3c; corrected by creating new branch on origin/main before edits. Original branch and stash unchanged.
Workflow: BUGFIX full scope; targeted architect verification -> implementation-plan review -> team-leader batches -> developers -> QA. CLI delegation enabled: user selected "combine both for maximum output" — specialist leads plus Ollama GLM/MiniMax focused helpers. Orchestrator coordinates disjoint assignments and owns synthesis; max three simultaneous CLI agents.

## Prior findings requiring current-source verification
- Tray onFocus only switches tabs, causing apparent dead clicks.
- hasRealAgentId can remain stale although AgentMonitorStore already has real ID. Never send fallback toolCallId as SDK agentId.
- Existing global transcript viewer and subagent:transcript RPC are one-shot; historical DTO reportedly omits tools.
- SDK forwardSubagentText defaults true. Parent result does not itself end session stream. Session abort differs from turn completion.
- Parent finalization replaces StreamingState; execution-tree builder excludes subagent messages from roots, potentially orphaning subsequent child output.
- Cross-workspace tab lookup/switch scope mismatch.
- backgroundList RPC may permit reload recovery, but owning session/workspace fields require verification.

## Architecture direction and unresolved evidence
GLM proposes new transcriptDelta push. MiniMax proposes existing turn-local StreamingState. Prefer reusing forwarded events with bounded agent/session-scoped retention independent of parent turns. Verify actual routing after finalization before choosing a new push. Do not add watcher/polling without proven missing delivery.
Verify SDK transcript tool blocks, stable IDs, pagination, error handling and renderer inputs. Snapshot/live merge must preserve legitimate repeated message deltas; a Set of messageIds is not sufficient. SDK subagents and external CLI monitors have distinct identity/source contracts; share presentation only where valid.

## Acceptance
- Pill opens correct execution immediately, including pending identity state.
- Two concurrent agents have isolated messages/tools and correct session attribution.
- Output continues after parent result and new parent turn.
- Closing/reopening viewer does not stop collection or duplicate output.
- Snapshot/live races preserve content and ordering.
- Cross-workspace actions use owning session; reload has explicit supported history limits.
- Retention bounded, truncation visible; errors distinct from waiting/empty.
- Regression tests plus interaction harness proof; verify actual Nx project/test counts.

## Constraints
Read per-module CLAUDE.md. Preserve hexagonal and frontend/backend boundaries; shared wire contracts; Angular signals/OnPush; existing markdown sanitizer. No unrelated refactoring, no commits or pushes. No shared Nx reset during other executors. All code work in this worktree; host Ptah tools may still target original root, so verify explicit scope. Write all agent reports alongside this context.
