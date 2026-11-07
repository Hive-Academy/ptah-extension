---
id: TASK_2026_598_e8df
status: backlog
type: BUGFIX
title: Confirm before an active-provider key change or login ends running chat sessions
depends_on: []
created: "2026-10-03T12:09:56.581Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  An active-provider key change and the Copilot, Codex, Kimi, connection-settings and
  workspace-scope handlers reset the SDK adapter, which ends running sessions with no confirm.
executor: backend-developer
estimate: M
labels:
  - settings
  - providers
  - needs-decision
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Some Settings actions end every running chat session, with no confirm and no session count:

- A key change for the active provider re-inits the SDK adapter and disposes every session.
- The interactive logins (Copilot, Codex, Kimi), the connection-settings write, the workspace-scope
  write and the config-scope write call `sdkAdapter.reset()` directly.
- The credentials Delete-key confirm does not say that running sessions end.

Remaining work:

- Before such a write, show "This ends N running chat sessions" and ask, or scope the reset to the
  sessions that use the changed credential. Get the user's decision first (label `needs-decision`).
- A session that uses the changed key must never continue silently with the old credential.
- Keep D15: show "Saved" only after the write's own result.
- Specs for each write path, and a live check in Electron recorded in a report.

## Current state (2026-11-07)

- Done in PR #720 (`ea8a2c4ca`, `4f571f8d1`): a key change for a provider that is not active ends
  only the sessions on that provider (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:327,376`).
- Open: direct `sdkAdapter.reset()` calls at
  `libs/backend/rpc-handlers/src/lib/handlers/auth/interactive-login-methods.ts:87,243,270`,
  `.../auth/kimi-code-login-methods.ts:118`, `.../auth/connection-settings-methods.ts:135`,
  `.../auth/workspace-scope-methods.ts:122` and
  `libs/backend/rpc-handlers/src/lib/handlers/config-scope-rpc.handlers.ts:141`.
- The Replace-key warning exists only for `anthropic`
  (`libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts:349`).
- The VS Code host was removed (PR #892), so only the Electron write paths need the change.

Full context, plan and discussion live in [./context.md](./context.md).
