# TASK_2026_452 — Initial session name consistency

Follow-up to TASK_2026_449 (PR #517). Ships on the same branch
`fix/task-449-peer-session-name-sync` by user decision.

## User intent

> When I initially start a session with a name in Ptah, we start a session in
> the agent SDK — what name gets assigned, and how is it reflected to the UI
> and the peer message button? ... Let's orchestrate a task to fix these
> findings.

## Name flow today (verified 2026-09-15)

1. Tab: user name → `titleOrigin: 'user'`; else `'default'` → first message
   `deriveSessionTitle` → `'auto'` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1379`).
2. `chat:start` sends `name` = user name, else derived title, else `'New Chat'`
   (`libs/frontend/chat/src/lib/services/message-sender.service.ts:377-417`).
3. `SdkAgentAdapter.startChatSession` → `sessionName = config.sessionName ?? config.name`
   (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:684`).
4. `--name` = `buildSessionName({ role: name, workspaceLabel, uniqueSuffix: tabId[0..6] })`,
   fallback role `chat`; `Options.title = name` for a new session
   (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1010,1036-1085`).
5. On SDK `init`: `metadataStore.create(uuid, workspace, config.name || 'Session <date>')`
   (`sdk-agent-adapter.ts:720-724, 947`).

## Findings in scope

- **F1 (defect)** — empty-name fallbacks disagree: metadata `Session <date>`
  vs `--name` role `chat` vs frontend `'New Chat'`. One session can carry two
  unrelated names.
- **F2 (defect)** — Ptah CLI agents: metadata name `CLI Agent: <agentId>`
  (`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:208`,
  `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:901`), while
  `--name` comes from `agentConfig.name`
  (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:721`).
- **F3 (investigate)** — `PeerSessionDirectory` `ptahTitle` covers only the
  current workspace, because `SessionMetadataStore` reads through
  `WorkspaceAwareStateStorage`. Decide whether a cross-workspace read exists.
- **F4 (investigate)** — whether the tab title can change after `chat:start`
  already sent a name, which would leave the tab and `--name` different
  without a rename.

## Out of scope

64-character cap, emoji-only fallback to `chat`, slug/prefix format, the
`ListAgents` display (owned by the CLI), and restart-on-rename (rejected in
TASK_2026_449).

## Lane plan

- Implement: `codex` lane, role `backend-developer`.
- Review: `claude cli` ptah-cli lane (different family), role `code-logic-reviewer`.
- Revise cap: 2 rounds. Orchestrator runs typecheck/tests/lint and commits.
