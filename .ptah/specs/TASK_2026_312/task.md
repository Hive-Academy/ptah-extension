---
id: TASK_2026_312
status: backlog
type: BUGFIX
title: >-
  The two hosts' harness boot lines still disagree on scope, and the shared
  formatter that fixed one of them has no spec
description: >-
  Two defects in the same concern, one per host. (1) The Electron host now leads
  its harness line with the AGGREGATE across all six targets and labels the
  claude slice explicitly, via the shared `formatHarnessLine` /
  `formatClaudeSlice` at
  `apps/ptah-electron/src/activation/plugin-activation.ts:349-392`. The VS Code
  host was not brought along: `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:286-294`
  still narrows to the claude target and logs `expected: claude?.expected ?? 0`
  and `found: claude?.found ?? 0` under those bare, unqualified field names —
  the exact spelling the Electron comment at `:359-365` describes as the defect
  both sites once shared. So one pass now emits `found=106/119 (all targets)`
  from Electron and `found: 14` from VS Code, and the reconciler's own WARN sums
  all six under the same bare names again. TASK_2026_306's Batch 5 made this
  strictly worse by fixing one side, and Batch 12 deliberately declined to paper
  over it rather than widen a third time. The `?? 0` is the second half: it
  collapses "never registered", "registered but undetected" and "genuinely
  nothing desired" into an identical `0`, which is precisely what
  `formatClaudeSlice` was written to stop. (2) Recorded as R4 —
  `formatClaudeSlice` is a pure three-branch function whose `0/0` state was an
  acceptance criterion and a named edge case, and it has no spec of its own. One
  spec, three cases. Fix both together: the VS Code host should call the same
  shared formatter, which makes R4's spec cover both hosts at once.
---

# The two host boot lines disagree on scope

Machine-owned metadata carrier. Prose lives in `./context.md`.
