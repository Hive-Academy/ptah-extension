---
id: TASK_2026_238
status: backlog
type: BUGFIX
title: Skills tab is gated Electron-only while its docs claim VS Code parity
description: >-
  `libs/frontend/skill-synthesis-ui/CLAUDE.md:16` states the Skills tab "works in
  both Electron and VS Code — skills are not desktop-only", but three independent
  gates make it unreachable from a real VS Code webview: `thoth-shell.component.ts:241`
  lists `skills` with `electronOnly: true`, `skill-synthesis-tab.component.ts:82`
  renders a desktop-only placeholder for the whole template when `!isElectron()`,
  and `webview-html-generator.ts:399-401` never sets `ptahConfig.isElectron` for a
  genuine VS Code host. Decide which side is right and make the other match. The
  four lane pickers added by TASK_2026_180 Phase 1 are among the surfaces currently
  unreachable in VS Code.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-14T00:00:00.000Z
updated: 2026-08-14T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
