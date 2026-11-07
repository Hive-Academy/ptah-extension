---
id: TASK_2026_155
status: backlog
type: FEATURE
title: >-
  Add a /goal workflow: a session completion condition with a Stop-hook evaluator loop
depends_on: []
created: '2026-08-09T15:26:27.168Z'
updated: 2026-11-07T00:00:00.000Z
description: >-
  Add a Claude-Code-style /goal command for Electron chat: a session-scoped completion
  condition, a Stop-hook evaluator loop, SQLite persistence, a goal: RPC namespace and an
  active-goal indicator. Nothing is implemented; the 2026-07-14 architecture was never approved.
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Goal workflow (/goal): session-scoped completion condition + evaluator loop

Full context, plan and discussion live in [./context.md](./context.md).

## Description

The user sets one goal per session with `/goal <condition>`. After each turn, a small model
reads the transcript and decides if the condition is met. If not, the Stop hook blocks the
stop and sends the reason back as guidance for the next turn. If yes, the goal clears and an
"achieved" entry is recorded. The goal survives session resume.

Remaining work (all of it):

- A backend goal lib (`GoalStore`, `GoalManager`, evaluator) with SQLite persistence in
  `libs/backend/persistence-sqlite`.
- A Stop-hook decision path in `libs/backend/agent-sdk/src/lib/helpers/stop-hook-handler.ts`
  and `stop-callback-registry.ts`.
- A `goal:` RPC namespace in `libs/shared` `rpc.types.ts` and in `ALLOWED_METHOD_PREFIXES`
  (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:44`).
- DI registration in the Electron container only (`apps/ptah-electron/src/di/`).
- A `/goal` chat command, status view and clear action in the renderer
  (`apps/ptah-extension-webview` plus `libs/frontend/chat*`).

## Current state (2026-11-07)

- Requirements were approved at Checkpoint 1 (2026-07-14). The architecture in
  `implementation-plan.md` was never approved at Checkpoint 2.
- No goal lib exists: `libs/backend/` has no `goal-workflow` folder, and no `goal:` RPC is
  registered.
- The VS Code host and the CLI host named in `task-description.md` and
  `implementation-plan.md` were removed in `1cee6fafe` (PR #892). Electron is the only host.
- The Stop-hook files the plan extends still exist in
  `libs/backend/agent-sdk/src/lib/helpers/`.
