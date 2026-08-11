---
id: TASK_2026_228
status: in_review
type: BUGFIX
title: >-
  thothActiveTab and marketplaceActiveProvider are still global while the view
  pointer beside them is now workspace-partitioned
description: >-
  TASK_2026_195 partitioned currentView and openViews per workspace on
  AppStateManager but left _thothActiveTab (app-state.service.ts:258) and
  _marketplaceActiveProvider (:265) as global singletons, because the carrier
  named neither and neither was the reported symptom. Both are the same shape
  of global view state and both have real consumers -- thoth-shell.component.ts
  and marketplace-state.service.ts -- so switching workspaces leaves the
  previous workspace's Thoth tab and marketplace provider selected. This is
  TASK_2026_195 scope item 4, which its context.md records as never re-checked.
  The partitioning pattern is now settled in three places (CanvasStore,
  TribunalStateService, and 195's ViewSlice), so this is applying a known
  shape rather than designing one.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-11T00:00:00.000Z
updated: 2026-08-11T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
