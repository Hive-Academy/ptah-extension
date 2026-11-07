---
id: TASK_2026_313
status: backlog
type: BUGFIX
title: >-
  Add Electron e2e coverage for the Marketplace harness health badge
description: >-
  The Marketplace harness health badge and its blocked-path list have unit specs but no e2e
  assertion. Add an Electron e2e that proves the badge renders and lists blocked paths. The
  Dashboard card half of the old task no longer applies.
parent: TASK_2026_640_11a5
labels:
  - P3
relates_to:
  - TASK_2026_280
updated: 2026-11-07T00:00:00.000Z
---

# Harness disclosure: no e2e, and an uncapped list on the home

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

Remaining work:

- Add an assertion in `apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts` that
  `ptah-harness-health-badge`
  (`libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:59`) renders,
  and that its popover lists blocked paths from `ptah-harness-blocked-paths`.
- Extend the `harness:health` fixture
  (`libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace.fixtures.ts:980`)
  with blocked paths if it has none.

## Current state (2026-11-07)

- The Dashboard `ptah-harness-card` no longer exists.
  `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.layout.spec.ts:17`
  asserts it is absent. The "uncapped list on the home" half is obsolete.
- The popover cap still holds: `harness-health-badge.component.ts:101`
  (`w-80 max-h-[26rem] overflow-y-auto`).
- The e2e spec only stubs `harness:health` (`marketplace.spec.ts:81`). No e2e locates the
  badge or the blocked-path list.
- `apps/ptah-extension-vscode-e2e` named in the old description was removed with the VS Code
  host (`1cee6fafe`).
