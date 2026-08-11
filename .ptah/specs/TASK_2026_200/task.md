---
id: TASK_2026_200
status: done
type: BUGFIX
title: >-
  ptah_workspace_analyze and ptah_search_files resolve the process-global
  workspace, not the calling session's
description: >-
  `PtahAPIBuilder.build()` wraps the platform `IWorkspaceProvider` in
  `buildSessionAwareWorkspaceProvider` and threads it into `systemDeps`,
  `analysisDeps` and `astDeps` — but `coreDeps` is built three lines earlier
  (`ptah-api-builder.service.ts:417`) and carries only the pre-constructed
  `WorkspaceAnalyzerService` and `ContextOrchestrationService`, each holding the
  raw DI-injected provider. So the `workspace` and `search` namespaces — MCP
  tools `ptah_workspace_analyze`, `ptah_workspace_get_info`, `ptah_search_files`
  — read the process-global active folder and ignore the caller session's
  `projectPath`. Reproduced live: a session whose cwd was
  `D:\projects\angular-3d-showcase` got `Root: D:\projects\property-hub` back
  from `ptah_workspace_analyze`, with the full file tree of the other project.
  Compounding it, `WorkspaceAnalyzerService.getCurrentWorkspaceInfo()` returns
  `this.workspaceInfo`, a snapshot cached in `initialize()` and refreshed only on
  `onDidChangeWorkspaceFolders`, so injecting the session-aware provider is
  necessary but not sufficient — the cache must become root-keyed or the getter
  must take a root.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
