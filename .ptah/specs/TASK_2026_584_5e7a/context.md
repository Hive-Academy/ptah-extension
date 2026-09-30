# TASK_2026_584_5e7a - context

## User request (2026-09-30)

> Our frontend can call the backend to start a new session, so allow the agent to create different sessions through our RPC commands and as tools. For example, you can orchestrate three different lanes. Each one creates a worktree, starts orchestrating a task, and reports back to you on anything through messages.

## Trigger

The same day, the orchestrator validated four in-progress tasks with CLI lanes (antigravity, Glm). The lanes were read-only reviewers. The user wants the next step: child sessions that do full orchestration (plan, implement, review) in isolated worktrees, supervised by a parent session.

## Known building blocks (to be verified by the research)

- `ptah_agent_spawn` / `ptah_agent_message` / `ptah_agent_report` / `<agent-lane-completed>` for CLI lanes.
- CLI lane to parent session linking: `callerSessionId` from the MCP URL path `/session/<sessionId>`, `parentSessionId` on `AgentProcessInfo`, `persistCliSessionReference`.
- TASK_2026_402: agent-scoped MCP URL identity and `AgentReportRouter`.
- TASK_2026_147: interactive agent sessions, `agent:continue` RPC.
- `ptah_git_worktree_add` / `_list` / `_remove` MCP tools.
- Frontend session start through chat RPC.

## User decisions (2026-09-30, after research-report.md)

- Approach A: new `ptah_session_*` MCP tools over an in-host `ISessionSpawner` that calls `startChatSession` directly (gateway pattern), not the chat RPC.
- Unattended child permissions: auto-edit plus a Bash allowlist. Bash outside the allowlist is denied with a bounded timeout, never an indefinite wait.
- ~~MVP has no UI tabs for children.~~ SUPERSEDED the same day: a child session binds to the UI automatically, as if the user created it manually (real tab, session list entry, resumable, the user can type into it). Hosts with no webview (CLI) degrade to headless.
- Control channel: the parent creates the session, then steers it by messaging (parent -> child send, child -> parent report, completion push). `ptah_session_status` / `ptah_session_read` stay as secondary tools.
- Coordinate the parent/worktree/task link data with TASK_2026_580_9f77 (session organization record). Do not build a conflicting schema.
- Coordinate with TASK_2026_358 (fleet runner) and TASK_2026_386 (worktree per task). Reuse what fits. Keep 584 separate.
- Orchestrator defaults (not asked, user may override): max 3 concurrent children, depth 1 (children cannot start children), the user owns merge / PR / worktree cleanup.

## User decisions (2026-10-01, on the architect's four disagreements)

- Children may call Ptah MCP tools (`mcp__ptah__*`) without a prompt: ACCEPTED.
- Parent end: the proposed 30 s grace stop is REJECTED. Children keep running when the parent ends or goes inactive; only the user stops them (`ptah_session_stop` or the child tab's Stop). The parent link is kept so a resumed parent can still steer its children. While the parent is not live, the architect's plan refuses child reports back to the child (counted in status) and holds the latest completion per child, returned on the parent's next `ptah_session_*` call.
- Child tabs do not take focus when they open: ACCEPTED.
- No permission argument on `ptah_session_start`: ACCEPTED.

## Phases

1. Feasibility research -> `research-report.md` (researcher-expert).
2. User decision on the approach.
3. Architecture -> `implementation-plan.md`, then implementation.
