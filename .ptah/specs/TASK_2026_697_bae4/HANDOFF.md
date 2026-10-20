# HANDOFF - TASK_2026_697_bae4 Voice page polish (merged grok + Glm)

Written 2026-10-18 at the end of an orchestrator session (user asked to wrap up). Session name
for peers: `ptah-ptah-extension-task-687-command-cen-b968170000xs42qjcizfr03`.

## Goal

Polish the Voice (Command Center) page by building on what exists, with ONE design that merges the
grok and Glm proposals (`.ptah/specs/TASK_2026_696_9529/proposal-grok.md`, `proposal-glm.md`).
Keep the canvas radial layout and motion. The user approved `implementation-plan.md` (18 ideas
V01-V18) and chose **all 3 phases** on this branch, one code-logic review per phase, one PR at the
end with dark + light before/after screenshots, then the #762 visual check.

## Where

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/voice-polish`, branch
  `feat/voice-polish`, from `main` `7267c1f4c` (contains #753, #757, #760, #762 - all merged).
- Task folder: `.ptah/specs/TASK_2026_697_bae4/` - `context.md` (request, rules, user decision),
  `implementation-plan.md` (approved plan: idea table, conflicts resolved, canvas/DOM design,
  contrast table, phases/batches, tests, decisions, risks), `batch-1A/1B/1C-report.md`,
  `previous-session-handoff.md` (handoff of TASK_2026_691/694/695/696, for background).
- Nothing on this branch is committed or pushed yet. The branch exists only locally.

## Done earlier in this session

- PRs #747, #753, #757, #760, #762 are merged. Their worktrees and local branches were removed
  (all commits verified in `main` first). `command-center-scene-redesign` (#749, closed unmerged)
  is kept as a reference. `command-center` and `command-center-review` belong to other tasks.

## Phase 1 state: implemented by 3 parallel codex lanes, NOT VERIFIED

Lanes ran in parallel, so by rule they ran NO nx/jest/tsc/lint. No orchestrator check, no review
has run on Phase 1 yet. Uncommitted: 17 modified files + 5 new files, all in
`libs/frontend/command-center/src/lib/`.

| Batch | Lane (CLI Session ID for resume) | Ideas | Files |
| --- | --- | --- | --- |
| 1A | `67796300` (`01a1502b-afd8-72a0-b0e4-21b67bc9e27b`) | V01 theme state/voice inks, V02 light orbit guides, V03 hover halo | `scene/command-scene-renderer.ts`, `scene/command-scene.component.ts` (+ specs), NEW `scene/scene-contrast.spec.ts` |
| 1B | `858e1be2` (`01a1502b-e446-7e13-a414-e4a893f3c6b2`) | V05 state edge, V06 shared detail foundation, V07 freshness + overflow counts | `model/command-center.store.ts`, `model/work-projection.ts`, `components/command-state-icon.ts`, `command-overlay.component.ts`, `command-work-list.component.ts`, `command-center-start.component.ts` (+ specs), NEW `command-node-detail.component.ts`, NEW `command-relative-time.ts` (+ specs) |
| 1C | `bde41dc4` (`01a1502c-0231-7ed0-909d-07ef07635dbd`) | V04 context chip (70% warning), V08 "N running · N waiting" | `command-center-page.component.ts` (+ spec) |

## Open problems

1. **Missing page wiring (from batch 1B, blocks Phase 1 acceptance).** 1B added inputs that the page
   (1C's file) does not bind yet:
   - `[now]` on `CommandOverlayComponent`, `CommandWorkListComponent`,
     `CommandCenterStartComponent` - must come from the ONE existing 30 s clock, which is private
     today at `command-center-page.controller.ts:64` (expose it; no new timers).
   - `[overflowCompleted]` and `[overflowOther]` on the work list - from `this.scene()?.layout()`
     (`scene` viewChild is private at `command-center-page.component.ts:481`).
   Give this to ONE codex lane (owns `command-center-page.component.ts`,
   `command-center-page.controller.ts` + specs) BEFORE the checks.
2. **29 diagnostic errors in sibling spec files** were reported by all three lanes as outside their
   files. The TASK_2026_691 lane reported the same 29 errors on old code, so they are probably
   pre-existing. Confirm with `npx nx typecheck command-center` (typecheck passed on main before).
3. `command-center-projection.source.ts` was listed for 1B but only its spec changed; check that the
   projection really carries `task` and the exact child `tabId` (1B report says so) - see
   `work-projection.ts`.

## Standing user rules

- Orchestration + agent-lanes skills. Implement with codex CLI lanes (`ptah_agent_list` before
  every spawn, never an AT LIMIT lane). Parallel lanes run no nx/jest; a single lane may run the
  scoped checks. Review shipping code with an Anthropic subagent (`code-logic-reviewer`): one codex
  fix round, then at most one bounded correction; stop and ask the user if Blocking/Serious remain.
- Memory-safe checks only: `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at a time, never
  workspace-wide, no build/serve/e2e except the approved Electron visual check.
- Run `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts` for every template change
  (it failed CI on #757 once). Never use `text-base-content/NN`.
- Commit in the foreground with hooks (never `--no-verify`); scopes `command-center` (and `chat-ui`
  if Phase 2B touches it), `task-specs` for docs; read `.commitlintrc.json` first. Push +
  `gh pr create` in the background. No local-only branches.
- Electron: port 9334 only. Announce "Electron: <session> launching, port 9334" to every peer
  (ListAgents) first, send "Electron: free" after. Kill only your own PID tree
  (`taskkill //F //PID <pid> //T`). Dev apps share `%APPDATA%\Ptah Dev` unless APPDATA points to a
  private folder. For a "before" build use a temporary detached worktree at `main` with a
  `node_modules` junction; remove the junction (`cmd //c rmdir`) before `git worktree remove`.
  Screenshot script: `C:/Users/abdal/AppData/Local/Temp/cc691/shot.js`
  (`node shot.js <prefix> probe|cc|start`, CDP on 9334; the Voice tab is
  `button[role="tab"][aria-label="Voice"]`).

## Exact next steps

1. Read `implementation-plan.md`, `context.md` and the three batch reports.
2. Wire the page (open problem 1) with one codex lane.
3. Verify Phase 1 in the worktree, one check at a time:
   ```bash
   cd /d/projects/ptah-extension/.claude-worktrees/voice-polish
   git status --short
   npx nx typecheck command-center --parallel=1 --output-style=static 2>&1 | grep -iE "error TS|Successfully ran|failed"
   npx nx lint command-center --parallel=1 --output-style=static 2>&1 | grep -E "✖|warning|error |Successfully ran|failed"
   npx nx test command-center --parallel=1 --output-style=static -- --maxWorkers=2 2>&1 | grep -E "Tests:|Test Suites:|●"
   npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep Tests:
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must stay 294
   ```
   Lint warnings on new/changed lines must be 0 (e.g. explicit-member-accessibility).
4. Code-logic review of Phase 1 by an Anthropic subagent (write `code-logic-review.md` in the task
   folder); one codex fix round; then commit Phase 1 (`feat(command-center): ...`) and the docs
   (`docs(task-specs): ...`).
5. Phase 2 (batches 2A canvas: V11 link gradients + chevrons, V12 speaking ripples, V13 cached voice
   halo, V14 backdrop sprite; 2B stats: V06 rest, V09 stats strip, V10 root context ring with a new
   optional tone input on `chat-ui` `context-ring.component.ts`; 2C start cards V16) - parallel only
   where the plan says the batches are file-disjoint. Review, commit.
6. Phase 3 (3A V15 elapsed arcs - only with a verified bound-agent `startedAt`; 3B V17 current-card
   figures, V18 speaker meter). Review, commit.
7. Push + PR (background). Electron visual check of the whole polish (before = main, after =
   branch, dark + light, start view + scene + hover card + work list), show the screenshots.
8. Then the #762 visual check: the user approved ONE short paid turn - start a new Command Center
   session, send "Reply with only the word ok.", restart the app, open Voice, choose the restored
   session from the start view, screenshot its provider mark (not the "P" monogram), dark + light.
9. Ask the user whether to remove `command-center-scene-redesign` (#749, closed) and this worktree
   after the PR merges.
