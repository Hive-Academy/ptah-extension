# Task Context - TASK_2026_453_1eb4

## User Request

Fix AC-11 (TASK_2026_437_0778) with the staged approach the user chose on 2026-09-15:
"Staged: cheap wins, then volume". First turn off auto-animate during the bulk mount and stagger
concurrent tile opens, then measure. Then virtualize the nested execution-node tree, or add
tail-paged history, only for the gap that remains. Measure every step with the Batch 22 spec.

## Task Type

BUGFIX (performance)

## Complexity

Medium

## Strategy

Partial: software-architect (staged plan) → team-leader → developer(s) → logic + style review per
batch → senior-tester measurement on an idle machine.

## CLI Lanes

Mode: enabled (user instruction 2026-09-16: "continue with codex cli").

- Implement batches: `codex` (cli, installed).
- Reviews: Claude family (Task code-logic-reviewer / code-style-reviewer), never the implementing lane.
- Decomposition, verify-and-commit: team-leader (Task). Commits never run on a lane.
- Measurements M0/M1: senior-tester (Task), idle machine only.

The worktree moved on 2026-09-16 from `D:\projects\ptah-453` to
`D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks`, because
`ptah_agent_spawn` rejects working directories outside `D:\projects\ptah-extension`
(TASK_2026_437 FU-22c). Branch `perf/task-453-tile-open-long-tasks`, fast-forwarded to
`origin/main` `51d0d2e1f` (PR #518 and PR #519 merged).

`ptah_agent_list` rows at Gate 0.1:

| Agent        | Type     | Status               |
| ------------ | -------- | -------------------- |
| codex        | cli      | installed            |
| copilot      | cli      | disabled (installed) |
| antigravity  | cli      | installed            |
| ollama cloud | ptah-cli | available            |
| claude cli   | ptah-cli | available            |

## Conversation Summary

- AC-11: open 3 tiles of a 2,000-event session; no renderer long task > 200 ms; total long-task
  blocked time <= 1,500 ms. Budget must not be loosened.
- Evidence (TASK_2026_437_0778 folder): `test-report-b22.md` (valid harness, dev cold 3-tile max
  1.5-1.9 s, total 5.4-6.2 s; prod 973 ms / 4,657 ms; warm 1-tile 119 / 433 ms passes),
  `fu22d-attribution-spike-report.md` (auto-animate off saves 31-39% only; Layout/Paint/GPU and
  FireAnimationFrame unchanged; blocked time ~3 ms per event, linear; last-clicked tile 79-98%;
  finalization/replay/CD each < 2%; `TranscriptRenderWindow` virtualizes top-level messages only).
- Include FU-22a: `_canvasSessionRequest` single-slot signal
  (`libs/frontend/core/src/lib/services/app-state.service.ts`) consumed by one effect in
  `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` loses tile opens on rapid clicks.
- Separate task and PR from TASK_2026_437 (user decision).
- Operating rules: TASK_2026_437_0778 `handoff.md` section 8 apply (max 2 test runners,
  `--maxWorkers=2`, idle machine for perf specs, explicit-path staging, review per batch).
