---
id: TASK_2026_244
status: done
type: DOCUMENTATION
title: Correct the stale VS Code parity claim in skill-synthesis-ui docs
description: >-
  `libs/frontend/skill-synthesis-ui/CLAUDE.md:16` claimed the Skills tab "works in
  both Electron and VS Code — skills are not desktop-only". That was wrong. All
  four Thoth tabs (Memory, Skills, Schedules, Gateway) are Electron-only by
  design, because the subsystem requires `SqliteConnectionService` (better-sqlite3)
  and the embedder worker, neither of which exists in the VS Code extension host —
  `SkillsSynthesisRpcHandlers` is listed in `EXPECTED_ABSENT_HANDLERS` and a spec
  enforces that the VS Code host never constructs it. The `electronOnly` gates in
  `thoth-shell.component.ts` and `skill-synthesis-tab.component.ts` are correct.
  Resolved by rewriting the doc section; no code change.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-14T00:00:00.000Z
updated: 2026-08-15T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
