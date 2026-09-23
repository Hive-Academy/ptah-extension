# PR #580 round 3 — Lane B

## Finding: valid

The previous lanes-mode permission loop selected each blocked workflow agent and immediately marked every request seen. A simultaneous update therefore displayed only the final agent and prevented earlier requests from being automatically presented later. Workflow tiles had status/name/token markup but no permission-count badge.

## Fix and evidence

- **Ordered, per-panel presentation:** `libs/frontend/chat/src/lib/components/organisms/agent-monitor/workflow-permission-presenter.service.ts:18` builds the pending workflow queue in request-timestamp order. Observed request IDs and actually shown request IDs are separate. The currently shown agent stays selected while a surfaced request is still pending; after resolution, the oldest unseen request becomes eligible.
- **Acknowledge only what is visible:** `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:864` asks for one workflow selection and marks its requests shown only after confirming that agent is selected in full-body detail. Other workflow requests remain queued. Standalone lane permission handling retains its existing pick/retry logic.
- **Respect explicit navigation:** `agent-monitor-panel.component.ts:944` and `:976` notify the presenter when the user changes selection or closes the transcript. Automatic selection uses the common private `applyAgentSelection` implementation without simulating user navigation. The presenter pauses automatic workflow selection after a user leaves a surfaced request; unchanged updates and resolution alone do not resume it. A genuinely new workflow request resumes oldest-first presentation.
- **Visible waiting badges:** `agent-monitor-panel.component.ts:130` maps each CLI workflow agent's queue length into its tile. The badge at `:350` uses the existing warning styling and an accessible pending-permission count.
- **Facade/state scope:** The new collaborator is injected and provided by each panel at `agent-monitor-panel.component.ts:167`, so canvas panels do not share queue or navigation state. Existing selector, inputs, outputs, public methods, permission actions, and OnPush behavior remain intact.

## Regression coverage

Added four panel test cases:

1. `agent-monitor/agent-lane-panel.spec.ts:464`: two blocked workflow agents arrive in reverse chronological array order. The oldest request is selected, the waiting tile shows its count, repeated updates preserve the current detail, and resolving the first automatically selects the second. This transition proves the second request was not prematurely marked seen.
2. `agent-lane-panel.spec.ts:518`: a new request from another workflow does not displace the currently surfaced pending request.
3. `agent-lane-panel.spec.ts:537`: parameterized coverage for selecting a standalone chip and closing a transcript. Existing pending requests and resolution do not steal the chosen view; a new request resumes presentation of the oldest unseen workflow request.

The existing same-tick arrival, rejected-pick retry, stale-selection, permission routing, lane layout, and responsive regressions also pass.

## Verification counts

Ran from the assigned worktree:

```powershell
npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat --skip-nx-cache --output-style=static 2>&1 | Select-Object -Last 30
```

Static output was used to preserve successful-task counts; the full output was captured to a temporary log and only tailed/filtered.

- **Targets:** 3 passed, 0 failed.
- **Tests:** 100 suites passed, 0 failed; 1,544 tests passed, 0 failed, 2 skipped (1,546 total).
- **Lint:** passed, 0 errors, 15 warnings.
- **Angular typecheck:** passed; existing unrelated NG8107 warnings remain.
- **Scoped diagnostics:** 0 errors in changed files. The provider also reports 245 existing unrelated project/dependency errors; the declared production Angular typecheck passes.
- **Formatting:** ran `npx prettier --write` on all three changed/created TypeScript files and this report.

The full suite emitted the previously observed worker-shutdown warning. No live-browser visual pass was performed. No requested behavior remains undone. No git commands or edits to other lanes' files were made.

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66/libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66/libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-panel.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66/libs/frontend/chat/src/lib/components/organisms/agent-monitor/workflow-permission-presenter.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66/.ptah/specs/TASK_2026_534_lane_console/pr-580-round3-lane-b.md`
