# HANDOFF - Command Center work (TASK_2026_691 / 694 / 695 / 696)

Written 2026-10-18 at the end of an orchestrator session (token budget reached). Session name
for peers: `ptah-ptah-extension-task-687-command-cen-b968170000xs42qjcizfr03`.

## Goal

Improve the Voice (Command Center) page on top of the canvas scene the user likes (radial layout,
motion - never redesign it from scratch):
provider marks for every session, a start view instead of auto-resume, the provider of restored
sessions, and a polish phase (proposals only so far).

## State of the tasks

| Task | Branch / worktree (`D:/projects/ptah-extension/.claude-worktrees/...`) | PR | State |
| --- | --- | --- | --- |
| TASK_2026_691_1da5 provider marks + state icons + overlay fixes | `fix/command-center-provider-marks`, `command-center-provider-marks` | #753 | **MERGED** 2026-10-18 15:39 UTC (`271198ced`). Worktree still exists. |
| TASK_2026_694_b504 start view (recent-session cards, New session, All sessions) + persona spoken-reply rule | `feat/command-center-session-start`, `command-center-session-start` (head `886c4358f`) | #757 | OPEN, MERGEABLE, BLOCKED = waiting for CI + approval. Main merged in (`20333f159`, conflict resolved). CI shard 3 failed on `no-alpha-base-content.spec.ts`; fixed in `886c4358f` (text-base-content/70 -> text-base-content-muted); CI re-run was pending at handoff. Electron visual check done (dark + light). |
| TASK_2026_695_3fdb restored-session provider (S1 of 691 review) | `fix/command-center-restored-provider`, `command-center-restored-provider` (head `c7f122362`) | #762 | OPEN, MERGEABLE, BLOCKED = waiting for CI + approval. Review APPROVED 8/10. **Electron visual check NOT done** (see next steps). |
| TASK_2026_696_9529 voice page polish proposals (grok + Glm) | `docs/voice-polish-proposals`, `voice-polish-proposals` (head `f36a13bd6`) | #760 | OPEN, docs only. The user has not yet picked ideas. |
| TASK_2026_687_615f (older) | `fix/command-center-open-issues`, `command-center-open-issues` | #747 | MERGED. Worktree kept; user never answered whether to remove it. |
| TASK_2026_689_4d4f (older) | `feat/command-center-scene-redesign`, `command-center-scene-redesign` | #749 | CLOSED unmerged (reference only). Worktree kept; user never answered. |

No branch is local-only. No lane or subagent of this session is running.

## What each PR does (short)

- **#757** `session-coordinator.ts`: `openStart()`, `refreshSessions()` (paginated `session:list`,
  per-request 5 s timeout, stale-response guard), `chooseSession()` (restore path, "already open
  in another tab" guard, orphan-tab close on failure, `choosing` guard), `chooseCurrentTab()`;
  `send()` with no session starts a new one; `openOrResume()` removed.
  `command-center-start.component.ts` (new). `command-center-workspace-binding.ts`: rebind loop
  retries only when the workspace changed during a load, max 3 passes. Persona rule in
  `libs/frontend/chat-state/src/lib/command-center-persona.ts:30`.
  Known Moderate (in PR body): toast `top-16` overlaps the header's right side; no timeout on the
  `choosing` guard if a restore never settles.
- **#762** `SessionMetadata.providerId` (agent-sdk `session-metadata-store.ts`,
  `sdk-agent-adapter.ts`): recorded at SDK init (new session), after a resumed turn and after a
  slash-command relaunch (best effort, logged); `create()` keeps an existing id; unchanged = no-op;
  a failed `create` still stops a new session as on main. Optional `providerId` on `chat:resume`
  reply and `session:list` rows (+ Zod). `TabState.providerId` (chat-types), set in
  `session-loader.service.ts` after stale checks, cleared on reset/rebind, sanitised in
  `tab-persistence.ts`. `tabProvider()` in `command-center-projection.source.ts` uses it last.
  Accepted decisions: no tab refresh after a provider switch (live data wins first);
  `activate:true` resume records the provider it launches with.

## Open problems and decisions

1. **#762 Electron visual check (user approved ONE short paid turn).** Plan: port 9334, shared
   dev profile (`%APPDATA%\Ptah Dev`; NODE_ENV=development forces it). On the #762 build (no
   start view - that is #757), open the Voice tab, click "Start new", send
   "Reply with only the word ok.", wait for the reply, close the app, relaunch, open Voice
   (auto-resumes the last Command Center session), screenshot the plate in dark + light: the
   restored root must show the provider mark, not the "P" monogram. Before = the monogram.
2. **#757 CI**: confirm the re-run passes (`gh pr checks 757`). If a check fails, read the failed
   job log (`gh run view <run> --job <job> --log-failed`) and fix in the worktree.
3. **Start-view card names** show raw prompt text such as `<command-message>agent-lanes...`
   (comes from `session:list` names). Asked the user whether to clean it up; no answer yet.
4. **Polish proposals (#760)**: ideas both proposals share (good Phase 1): theme state-ink colors
   for canvas rings (light theme fails contrast today), session stats strip (cost, tokens, agents,
   duration) via `SessionStatsSummaryComponent` / `CostBadgeComponent`, context % chip with the
   70% warning, one detail body for hover card + side panel, richer start cards. The user has not
   picked ideas. Files: `.ptah/specs/TASK_2026_696_9529/proposal-grok.md`, `proposal-glm.md`.
5. Ask the user whether to remove the merged worktrees `command-center-open-issues` (#747),
   `command-center-provider-marks` (#753) and the closed `command-center-scene-redesign` (#749).
   Remove a worktree only after removing its `node_modules` junction first:
   `cmd //c rmdir "<worktree>\node_modules"`, then `git worktree remove <path>`.
6. Light-theme contrast of other setup hub cards (from 687) - candidate separate task.

## Standing user rules

- Orchestration + agent-lanes skills. Implement with codex CLI lanes (`ptah_agent_list` before
  every spawn, never an AT LIMIT lane). Review shipping code with an Anthropic subagent
  (`code-logic-reviewer`), one fix round, then at most one bounded correction; stop and ask the
  user if Blocking/Serious items remain.
- Memory-safe checks only: `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at a time,
  never workspace-wide, no build/serve/e2e except the approved Electron visual check.
- Commit in the foreground with hooks (never `--no-verify`); push + `gh pr create` in the
  background. Read `.commitlintrc.json` first. No local-only branches.
- Run `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts` for any template change
  (this was missed once and failed CI on #757).
- Electron: port 9334 only. Announce "Electron: <session> launching, port 9334" to every peer
  (ListAgents) first, send "Electron: free" after. Kill only your own PID tree
  (`taskkill //F //PID <pid> //T`). Dev apps share `%APPDATA%\Ptah Dev` unless APPDATA is pointed
  at a private folder - do not run on the shared profile while another dev app uses it.
- Task folders: `ptah_task_create` writes into the main checkout; move the folder into the task
  worktree (copy, `cmp`, delete) so the main checkout stays clean.

## Key files

- `libs/frontend/command-center/src/lib/components/`: `command-center-page.component.ts`,
  `command-overlay.component.ts`, `command-work-list.component.ts`, `command-state-icon.ts`,
  `command-center-projection.source.ts`, `command-center-start.component.ts` (#757),
  `command-center-workspace-binding.ts` (#757)
- `libs/frontend/command-center/src/lib/model/session-coordinator.ts` (#757)
- `libs/frontend/command-center/src/lib/scene/` (canvas - do not change without a user decision)
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`, `sdk-agent-adapter.ts` (#762)
- Screenshot script (outside the repo): `C:/Users/abdal/AppData/Local/Temp/cc691/shot.js`
  (`node shot.js <prefix> probe|cc|start`, attaches over CDP to port 9334). Earlier screenshots
  are in the same folder.

## User decision after the handoff (2026-10-18)

> for the polish idea, i think we if we merged both of the agents reviews we will have a more
> beautiful view, i think we should be working on this in our new session before we do the visual
> review for pr 762, and do it afterwards

So the order is: (1) polish phase that MERGES both proposals, (2) then the #762 visual check.

## Exact next steps

1. `gh pr checks 757`, `gh pr checks 762`, `gh pr checks 760`. Fix any failed job in its worktree
   (scoped checks below), commit in the foreground, push in the background.
2. **Polish phase (new task, before the #762 visual check).**
   - Create a task (`ptah_task_create`, type FEATURE, relatesTo TASK_2026_696_9529) and a worktree
     from `main`. The polish touches the start view (#757) and the provider id (#762): if they are
     merged by then, branch from the new `main`; if not, ask the user whether to wait or to branch
     from `main` and leave the start-view items (proposal group d) for a follow-up after #757.
   - Merge the two proposals into one design (`implementation-plan.md`) with a codex lane
     (role software-architect): take the ideas both proposals share as the base, add Glm's visual
     ideas (provider-tinted link gradients + chevrons, hover halo, speaking ripples, elapsed-time
     arcs, state-color left border) under grok's performance and contrast rules (resolve state inks
     once per theme change, cached sprites/gradients, DPR cap 2, reduced-motion gates, no CSS
     variable reads in `draw`, measured contrast in `anubis` and `anubis-light`). Keep the radial
     layout and motion; no from-scratch redesign. The orchestrator reviews the plan against both
     proposals and the code before implementation; show the merged idea list to the user.
   - Implement in phases (Phase 1 quick wins first) with codex lanes, one Anthropic
     code-logic review per phase (one fix round, then at most one bounded correction).
   - Electron visual check of the polish (before = main, after = branch, dark + light), then PR.
3. #762 Electron visual check AFTER the polish (step "Open problems" 1). If the polish branch
   already contains #762 (merged into main), one combined visual session can cover both. Build and
   launch:
   ```bash
   cd /d/projects/ptah-extension/.claude-worktrees/command-center-restored-provider
   NX_DAEMON=false npx nx build-dev ptah-electron --parallel=1 --output-style=static 2>&1 | tail -3
   NX_DAEMON=false npx nx copy-renderer-dev ptah-electron --parallel=1 --output-style=static 2>&1 | tail -2
   NODE_ENV=development ./node_modules/electron/dist/electron.exe --remote-debugging-port=9334 \
     --use-fake-ui-for-media-stream --use-fake-device-for-media-stream dist/apps/ptah-electron/main.mjs
   ```
   Show the screenshots to the user; tick the "Electron visual check" box in the PR body.
4. Ask the user: start-view card names (open problem 3) and worktree removal (open problem 5).
   Open problem 4 is answered: merge both proposals (step 2).
5. Scoped verification commands (per changed project P):
   ```bash
   npx nx typecheck P --parallel=1 --output-style=static 2>&1 | grep -iE "error TS|Successfully ran|failed"
   npx nx lint P --parallel=1 --output-style=static 2>&1 | grep -E "✖|error |Successfully ran|failed"
   npx nx test P --parallel=1 --output-style=static -- --maxWorkers=2 2>&1 | grep -E "Tests:|Test Suites:|●"
   npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep Tests:
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must stay 294
   ```
   For several projects: `npx nx run-many -t test -p A B --parallel=1` (check the header count).
