# PR #580 fixes — Lane B

Both findings were verified against the current source and are valid. Both are fixed; no finding was skipped. The chat test, lint, and typecheck targets all pass.

## Finding 1 — fallback workflow hides the grid: valid

The previous `showLaneGrid` read `effectiveSelectedAgent()`, whose first-agent fallback could resolve to a workflow after the selected agent disappeared. Meanwhile, `selectAgent` set the workflow-detail flag for standalone picks as well.

- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:604`: grid visibility now uses the explicitly resolved CLI selection, alongside the existing exact workflow-subagent selection.
- `agent-monitor-panel.component.ts:722`: added `explicitSelectedAgent`, which returns null for a missing ID and never falls back to another agent. The existing single-view fallback remains unchanged.
- `agent-monitor-panel.component.ts:909`: a pick sets the workflow-detail flag only when it resolves to a current workflow CLI agent or workflow subagent.
- Regression coverage: `agent-monitor/agent-lane-panel.spec.ts:225` reproduces picking standalone `a`, removing it while a workflow is first, and verifies that two lanes remain visible. The test at line 254 also verifies that removing an explicitly selected workflow does not substitute another workflow's detail.

## Finding 2 — hidden workflow permissions / premature acknowledgement: valid

The previous permission effect passed workflow IDs into a grid that accepts only standalone agents and marked requests seen before checking the result. A newly arriving standalone could also be missing from the grid's inputs when the parent effect first ran.

- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:813`: the effect tracks the grid's agent input as well as the current panel agents, allowing another run when this tick's child bindings catch up.
- `agent-monitor-panel.component.ts:825`: new workflow CLI requests follow `selectAgent`, the same path as a workflow tile click, opening the full-body detail and its permission controls.
- `agent-monitor-panel.component.ts:842`: standalone requests are acknowledged only after `grid.shownIds()` contains the agent. Rejected picks remain eligible for retry. Already surfaced requests remain deduplicated so ordinary emissions do not override later user choices.
- Regressions at `agent-monitor/agent-lane-panel.spec.ts:429` cover both an existing workflow agent and a workflow agent arriving with its permission in the same tick, including its visible Allow control. Line 464 covers a standalone agent and permission arriving together. Line 481 forces the first pick to be rejected, then verifies the same request is successfully retried.

## Verification

Ran from the assigned worktree:

```powershell
npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat --skip-nx-cache --output-style=static 2>&1 | Select-Object -Last 30
```

The static-output flag exposes successful-task counts; output was also captured to a temporary log.

- **Targets:** 3 passed, 0 failed.
- **Tests:** 100 suites passed, 0 failed; 1,540 tests passed, 0 failed, 2 skipped (1,542 total).
- **Lint:** passed, 0 errors, 15 warnings. The existing facade max-lines warning remains; the fix stays within its existing selection/permission responsibilities rather than introducing an unrelated extraction.
- **Angular typecheck:** passed. Existing NG8107 warnings remain outside the changed files.
- **Scoped diagnostics:** 0 errors in the two changed files. The provider additionally reports 245 existing unrelated project/dependency errors; the declared production typecheck passes.
- The successful test run emitted a worker-shutdown warning, also observed in earlier task runs. Its source was not investigated in these scoped fixes.
- Ran `npx prettier --write` on both changed TypeScript files and this report.

No requested fix remains undone. No live-browser visual pass was performed. No git commands or out-of-scope edits were made.

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66/libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66/libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-panel.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66/.ptah/specs/TASK_2026_534_lane_console/pr-580-fixes-lane-b.md`
