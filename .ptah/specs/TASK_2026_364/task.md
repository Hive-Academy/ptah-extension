---
id: TASK_2026_364
status: in_review
type: BUGFIX
title: >-
  CLI agent spawning validates against the process-global workspace root, not the
  calling session's workspace
depends_on: []
created: '2026-08-31T19:00:00.000Z'
updated: '2026-08-31T19:00:00.000Z'
description: >-
  AgentProcessManager injects the raw PLATFORM_TOKENS.WORKSPACE_PROVIDER
  singleton, so validateWorkingDirectory compares the requested directory
  against ElectronWorkspaceProvider.activeFolder — a process-global value that
  any open workspace can repoint. The session-aware fix (workspace-root-resolver
  plus buildSessionAwareWorkspaceProvider) already exists but is wired only into
  PtahAPIBuilder namespaces, so ptah_agent_spawn and its siblings were never
  covered. Result — with two workspaces open in Electron, a spawn from workspace
  A is rejected with "Working directory must be within workspace root. Expected
  prefix - workspace B", and the whole ptah_agent_* surface goes dark for A.
estimate: S
labels:
  - multi-workspace
  - cli-agents
  - mcp
  - electron
  - regression-gap
---

# CLI agent spawning ignores the calling session's workspace

`ptah_agent_spawn`, `ptah_agent_status`, `ptah_agent_read` and `ptah_agent_stop`
resolve the workspace root from the process-global active folder instead of the
workspace of the session that issued the call.

Observed 2026-08-31 with two workspaces open in the Electron app. Every
`ptah_agent_*` call from the `ptah-extension` window failed or returned an empty
registry, because the active folder had moved to `property-hub`.
