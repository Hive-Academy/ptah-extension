---
status: backlog
type: refactoring
title: >-
  gridstack 12 -> 13
description: >-
  gridstack 13 turns `nodesCB` into a pure type alias with no runtime export.
  The tribunal page imports it as a value, and the unit-test stub exports it as
  a constant. Both break. The audit in TASK_2026_498_5513 found no other
  affected call site, so the change is two lines plus the version lift.
---

# gridstack 12 -> 13

Follow-up 8 of TASK_2026_498_5513. The full consumer audit is in
`.ptah/specs/TASK_2026_498_5513/lane-wave-4d.md`.

## What breaks

1. `libs/frontend/tribunal-panel/src/lib/tribunal-page.component.ts:13` imports
   `nodesCB` as a value. Change it to `type nodesCB`.
2. `libs/frontend/tribunal-panel/src/test-gridstack-stub.ts:32` exports
   `nodesCB` as a constant. Change it to a type alias.

## What does not break

`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` uses no
affected API. Every call site in the audit survives.

The 13.x Angular wrapper changed the convention for dynamic component creation
(`selector` + `input` became `component` + `props`, and
`addComponentToSelectorType` became `registerComponents`). Neither consumer
uses dynamic instantiation, so that change does not reach this repository.

## Scope

1. Lift `gridstack` to `^13.3.0`.
2. Apply the two changes above.
3. Confirm the canvas grid and the tribunal page still drag, resize and lock.
