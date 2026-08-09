---
id: TASK_2026_195
status: backlog
type: BUGFIX
title: View mode and canvas/tribunal state are global while session state is workspace-partitioned
description: currentView and layoutMode live on AppStateManager as global singletons and are never touched by WorkspaceCoordinatorService.switchWorkspace, which switches only TabManagerService, SessionLoaderService and the four editor services. CanvasStore is scoped per OrchestraCanvasComponent instance and TribunalStateService is not workspace-keyed, so switching workspaces leaves the previous workspace's view mode, canvas tiles and tribunal state on screen against the new workspace's sessions. Also records an unchecked switchGeneration in the editor-services loop. Surfaced while investigating TASK_2026_187 (webview bundle splitting); explicitly kept out of that task's scope.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-09T00:00:00.000Z
updated: 2026-08-09T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
