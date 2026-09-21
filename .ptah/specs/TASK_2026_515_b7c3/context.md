# Context

## User intent (2026-09-21)

The user recalls earlier work on this and asked for it as a side quest, separate from the
lane A / lane B programme of `.ptah/specs/TASK_2026_490_583c`:

> i recall we worked on away to update the cli agents and main agents to include prompts and
> also in agent lanes skill so that when a cli agent finishes it notify the main agent rather
> keeps waiting

Two parts, both wanted:

1. **Mechanism** — a CLI agent lane pushes a completion signal to the session that spawned it.
2. **Prompts and skill** — the spawn prompt guidance and `.claude/skills/agent-lanes/SKILL.md`
   change so a finishing lane reports what it produced, instead of exiting silently.

## What the workspace memory already records

Three separate memory entries agree on the current state, so this is confirmed, not assumed:

- CLI agents spawned through `ptah_agent_spawn` do not push completion notifications to the
  orchestrator. The `agent-lanes` workflow is poll-based.
- There is no built-in wait and no completion push into the parent session. A lane can report
  `completed` with exit code 0 even when its requested deliverable was never written.
- `ptah_agent_report` is **not** a completion signal. The `background_agent_completed` stream
  event is for the webview UI and **has no producer** for orchestrator notifications.

That last point is the crux: the event type already exists, but nothing on the backend emits it
for this purpose.

## Starting points in the code

These are locations to confirm, not conclusions. Line numbers may have moved.

| Area | Path |
| --- | --- |
| Agent process manager | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` |
| Manager helpers | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager-helpers.ts` |
| Shared agent types | `libs/shared/src/lib/types/agent-process.types.ts` |
| The existing event type | `libs/shared/src/lib/types/execution/stream-background.ts` |
| Webview consumer | `libs/frontend/chat/src/lib/components/organisms/background-agent-tray.component.ts` |
| Turn-end handling | `libs/frontend/chat/src/lib/services/chat-store/turn-end-handler.service.ts` |
| Spawn tool surface | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts` |
| Spawn tool description | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` |
| The skill | `.claude/skills/agent-lanes/SKILL.md` |

## Constraints

- Backend libs depend on `platform-core` ports only. The notification path must not reach into a
  concrete adapter.
- A new RPC namespace needs BOTH the compile-time contract in `libs/shared/.../rpc.types.ts` and
  the runtime guard entry in `ALLOWED_METHOD_PREFIXES`
  (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:46`).
- The code must run unchanged in all three hosts: VS Code, Electron and the headless CLI. A
  signal that only works when a webview is open is not a solution.
- Frontend libs must not import backend libs. `libs/shared` is the one bridge.

## Known hazard

**Exit code 0 does not mean the deliverable exists.** Any completion signal that only reports
process exit repeats the defect the memory entry names. The signal must carry enough for the
orchestrator to decide whether the lane actually did the work.

## Source

Workspace memory entries `cli-agent-completion-protocol`, `cli-lane-completion` and
`cli-agent-completion-reporting`.
