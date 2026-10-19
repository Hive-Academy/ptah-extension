# HANDOFF - TASK_2026_700_dcce Align the Voice page with the 678 prototype and app style

Written 2026-10-19 at the end of an orchestrator session (user asked to wrap up). Replaces the
previous handoff.

## Goal

Bring the Ptah Command Center Voice page (`libs/frontend/command-center`) to the user-approved
design (Gate 1.7): the look of the TASK_2026_678 prototype, aligned with the Chat and Tribunal
pages, plus display-only child sessions. Target look: `prototype/screenshots/*.png` in this task
folder (19 captures, dark and light).

## Where

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/voice-prototype-align`, branch
  `feat/voice-prototype-align`, tracks `origin/feat/voice-prototype-align`. It has a
  `node_modules` junction to the main checkout (remove it with `cmd //c rmdir node_modules`
  before `git worktree remove`).
- Task folder: `.ptah/specs/TASK_2026_700_dcce/` in that worktree.
- **No PR yet.** Open it after Phase A (see next steps).

## Done

| Commit | Content | Pushed |
| --- | --- | --- |
| `e1dcf8a98` docs(task-specs) | Approved design: parity inventory, design spec, prototype, 19 screenshots, design reviews r0/r1/r2, revisions 1/2 | yes |
| `af151362c` docs(task-specs) | Implementation plan, plan reviews (r0 REVISE, r1 APPROVED), plan-revision-1, batches.md, decisions D7-D9 | yes |
| `5bd6dec9e` feat(command-center) | Phase C: selected-work card (C1), nested delegated rail + pending cards (C2), review + fix round; checks pass (509 tests) | yes |

Gates passed: Gate 1.7 design (user APPROVED), Gate 2 plan (`implementation-plan-review-r1.md`
APPROVED, lane-review mode).

## In progress at handoff - Phase D (Canvas scene + overlay plates)

- D1 (`scene/scene-layout.ts`), D2 (scene component, renderer, new `scene/command-scene-decoration.ts`)
  and D3 (`components/command-overlay.component.*`, new `.css`) are implemented, NOT committed.
- Phase D review `code-logic-review-phase-d.md`: NEEDS_FIXES 6/10 (3 Serious layout defects,
  renderer 736 lines > 700, two wrong overlay tests, 5 recommended items).
- Fix lane `de40f5d6-9ea2-40b0-9b13-39cbf6d12573` (codex) is the one and only Phase D fix round.
  Deliverable `batch-D-fix-report.md`. See "Status at end of session" below for its final state.

## Remaining phases (from `batches.md`)

| Phase | Batches | Note |
| --- | --- | --- |
| D canvas | D1, D2, D3 | implemented; fix round, then commit |
| B dock | B1 | single lane; D7: the prototype "Resume last" slot renders the existing Start new action |
| A page | A1, then A2a, then A2b | strictly sequential; A2b passes `reservedTop` to the scene and owns `command-center-page.component.spec.ts` (N2: rewrite the rail-scroller test at lines 527-545) |

Per phase: codex lanes implement -> orchestrator runs the checks -> Anthropic
`code-logic-reviewer` subagent -> at most one codex fix round -> commit (scope `command-center`).

## Decisions (full list in `decisions.md`)

- D3 is superseded by **D9**: NO "Open tab" feature. Child sessions are display only (sphere,
  second silver ring when live, dashed dimmed "CS" sphere when persisted, plate, tether to owned
  work, rail rows with GitBranch glyph, selected card with real fields). User's reason: the Voice
  page keeps the user away from CLI tools; execution surfaces only questions and permissions.
- D4: M1 context ring orange only at >= 70% (same as header chip); M3 Crucible plate clears its
  sphere at 900px; M4 tether + anchored owned-lane plate + child glyph.
- D7: dock "Resume last" slot = existing Start new (no new resume action). Tell the user at the
  final visual check that this label differs from the approved screenshot.
- D8: degradation audit 294, injected Logger, GSAP allowed are user/project rules.
- Item 8 of the Phase C review ("Delegated engineering work" subtitle) kept: approved design copy.

## Open problems

- The Phase D fix result must be verified by the orchestrator (checks below), then committed.
- `ptah_get_diagnostics` reports 29 errors in sibling spec files when lanes scope it; Nx
  typecheck passes, so treat those as tool noise unless typecheck fails.
- `ptah_agent_list` can time out and show every lane as unknown; call it again until codex shows
  confirmed room before any spawn.

## Standing user rules

- Orchestration + agent-lanes skills. Codex CLI lanes implement (`ptah_agent_list` before every
  spawn; never an AT LIMIT lane; grok is AT LIMIT until 2026-10-20 17:40 UTC). Parallel lanes run
  no nx/jest; a single lane may run scoped checks. Anthropic `code-logic-reviewer` subagent per
  phase, one codex fix round per phase. Document gates use an Anthropic cross-side reviewer.
- Memory-safe checks only: `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at a time
  (including the pre-push hook: do not run checks while a push is in flight), never
  workspace-wide; no build/serve/e2e except the Electron visual check.
- Run the no-alpha-base-content spec for every template change. Never `text-base-content/NN`.
  Degradation audit must stay at 294.
- Canvas 2D only; no 3D libraries; lucide icons and GSAP allowed.
- Commit in the foreground with hooks; scope `command-center` (code) / `task-specs` (docs); read
  `.commitlintrc.json`. Push (+ `gh pr create`) in the background. No local-only branches.
- Electron: port 9334 only. Announce "Electron: <session> launching, port 9334" to every peer
  (ListAgents) first; send "Electron: free" after. Wait if a peer runs Electron with the user's
  normal profile. Build: `NX_DAEMON=false npx nx build-dev ptah-electron --parallel=1` then
  `copy-renderer-dev`; launch `NODE_ENV=development ./node_modules/electron/dist/electron.exe
  --remote-debugging-port=9334 --use-fake-ui-for-media-stream --use-fake-device-for-media-stream
  dist/apps/ptah-electron/main.mjs`. Screenshot script:
  `C:/Users/abdal/AppData/Local/Temp/cc697/shot.js` (`node shot.js <prefix> start|scene`). Real
  delegated work needs paid turns - ask the user first.

## Key files

- Task docs: `context.md`, `decisions.md`, `design-spec.md`, `implementation-plan.md`,
  `batches.md`, `parity-inventory.md`, reviews `design-spec-review-r2.md`,
  `implementation-plan-review-r1.md`, `code-logic-review-phase-{c,d}.md`, batch reports
  `batch-*-report.md`, `prototype/`.
- Code (under `libs/frontend/command-center/src/lib/`): `components/command-center-page.component.ts`
  (+ controller), `command-center-start.component.ts`, `command-overlay.component.ts`,
  `command-node-detail.component.ts`, `command-work-list.component.ts`,
  `command-pending-input.component.ts`, `command-session-stats.component.ts`,
  `command-voice-hud.component.ts`, `command-session-controls.component.ts`,
  `scene/command-scene.component.ts`, `scene/command-scene-renderer.ts`,
  `scene/command-scene-decoration.ts`, `scene/scene-layout.ts`, `scene/sprite-cache.ts`,
  `model/work-projection.ts`.

## Exact next steps

1. Read this file, `decisions.md`, `batches.md` and `code-logic-review-phase-d.md`.
2. If lane `de40f5d6-...` has not ended, wait for its completion signal (`ptah_agent_wait`), then
   read `batch-D-fix-report.md`.
3. Verify Phase D yourself, one check at a time:
   ```bash
   cd /d/projects/ptah-extension/.claude-worktrees/voice-prototype-align
   npx nx typecheck command-center --parallel=1 --output-style=static 2>&1 | grep -E "error TS|Successfully ran|failed"
   npx nx lint command-center --parallel=1 --output-style=static 2>&1 | grep -E "error|warning|problems|Successfully ran|failed"
   npx nx test command-center --parallel=1 --output-style=static --maxWorkers=2 2>&1 | grep -E "Tests:|Test Suites:|FAIL"
   npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep Tests:
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must stay 294
   ```
   All must pass with 0 lint errors/warnings. If a defect remains after the one fix round, make
   one bounded correction and have it reviewed, or report it to the user (revise cap).
4. Commit Phase D in the foreground (`feat(command-center): ...`, add the D batch/fix reports and
   the review), mark Phase D done in `batches.md`, push in the background.
5. Phase B: one codex lane for B1 (brief from `implementation-plan.md` "Phase B" + batches.md
   addenda + D7), checks, Anthropic review, one fix round, commit.
6. Phase A: A1, then A2a (mechanical extraction), then A2b (wiring, `reservedTop`, page spec
   N2 rewrite, `toggleTheme()` test), each a single lane with checks; Anthropic review of the
   phase, one fix round, commit.
7. Electron visual check (dark + light) against `prototype/screenshots/`, following the Electron
   rules above; show the user the before/after screenshots, including the D7 label difference.
8. Push and `gh pr create` in the background (title under 70 chars, `## Summary` + `## Test
   plan`, end with the Claude Code attribution line). Fix CI and CodeRabbit comments. Ask the
   user before removing the worktree after merge.

## Status at end of session

- Phase D fix lane `de40f5d6-9ea2-40b0-9b13-39cbf6d12573` **completed** (exit 0, verdict
  delivered). It wrote `batch-D-fix-report.md` and claims all 11 items are fixed (6 must-fix,
  5 recommended), with a new `scene/command-scene-status.ts` (renderer split). Its own checks:
  typecheck pass, lint 0 errors / 0 warnings, 527/527 tests (45 suites), alpha guard 11/11.
- The orchestrator has NOT re-run the checks after the fix and has NOT committed Phase D
  (user asked to wrap up). Phase D changes are uncommitted in the worktree. Start at step 3.
- Fix lane CLI Session ID: `01a15231-90a4-7b60-a698-9180e92ce4e4` (resume only for a bounded
  correction; the phase fix round is used up).
- No subagent or lane is running. Last pushed commit: `5bd6dec9e`.
