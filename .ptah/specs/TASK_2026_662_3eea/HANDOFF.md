# HANDOFF - Skills epic (TASK_2026_639 + TASK_2026_662) - 2026-10-19 (session 4)

## Goal

The user approved the full skills epic:

- Epic TASK_2026_639 children: TASK_2026_644 (PR #756 MERGED) and TASK_2026_435 (PR #759 MERGED).
- TASK_2026_662: delete the skill-synthesis pipeline in place, keep and fix the Library, add a success
  signal derived from task-folder reviews, archive then drop the pipeline data. 72 batches + carry-over
  tasks in 6 phases (A-F) in `batches.md`.
- Out of scope: epic TASK_2026_640 (harness-sync distribution).
- New follow-up task (user request): TASK_2026_701_9e4b (see "Follow-up tasks").

## Done

| Item | Branch / worktree | State |
| --- | --- | --- |
| TASK_2026_644 | `docs/skills-lane-messaging` | PR #756 MERGED |
| TASK_2026_435 | `docs/skills-rubric-sweep` / `.claude-worktrees/skills-rubric-sweep` | PR #759 MERGED (all CI green, no new CodeRabbit review). Nothing left. |
| 662 Phase A (1-15) | `refactor/skill-synthesis-purge` / `.claude-worktrees/skill-synthesis-purge` | CLOSED (see batches.md). |
| 662 Phase B (16-24 + 24a) | same | CLOSED. 23 `691777d85`, 24 `7e64882c2`, docs `829600e7f`; review fix round `82001de93`, 24a layout `ce95da1bf`, docs `78b5d7b9a`. |
| 662 Phase C wave 1 | same | 32 `2629b316c`, 26 `65dab6e26`, 30 `81f2533ca`, docs `d164ab9c6`. |

Phase B reviews: code-logic REVISE 6/10 -> r2 APPROVED 8.5/10; visual REVISE 5/10 -> r2 REVISE 7/10 (tile
clip) -> r3 APPROVED. Root cause of the user-seen "skillSynthesis:listClones failed": missing `@inject` on
`SkillScorecardService.events` (fixed in `82001de93`).

Branch `refactor/skill-synthesis-purge` is NOT pushed (local only). HEAD `147fd34c6` (TASK_2026_701 folder on top of `d164ab9c6`).

## In progress (UNCOMMITTED in the 662 worktree) - Phase C, second set

No lane or subagent is running. Three codex lanes finished (verdict delivered). NO gate has run on them.

1. **Task 25.1 (core lanes/judging slices) - STOPPED, no source edits.** Report `reports/batch-25-1-report.md`.
   Shared-contract stop: `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:164`
   calls `state.refreshJudging()` (spec fake :118, assertion :488). Lane recommends: first switch that
   handler + spec to `refreshEnhancement()` (exists in core), then rerun 25.1. Decide (decision ladder;
   recommended: add the chat file + spec to Task 25.1, gate core + chat already covers it, record as O24).
   O20 projects that fake `ProvidersSettingsStateService`: chat, core, memory-curator-ui, setup-wizard,
   webview-e2e-harness -> add them to the 25.1 gate.
2. **Batch 31 (Electron IPC / host profiles) - DONE, unverified.** Only a comment change in
   `apps/ptah-electron/src/ipc/ipc-bridge.ts:204`. The batch's listed files `apps/ptah-electron/src/ipc/rpc-host-profile.ts`
   and a CE profile spec do not exist; real files are `apps/ptah-electron/src/rpc-host-profile.ts:28` and
   `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:79`; both keep `skillSynthesis` (Library).
   Gate: `npx nx run-many -t test typecheck -p ptah-electron @ptah-extension/cli-engine --parallel=1`.
3. **Batch 27 (Library is the sole Skills view) - PARTIAL, unverified.** Report `reports/batch-27-report.md`.
   Edited: `SU/components/skill-synthesis-tab.component.ts` + spec, `SU/services/skill-synthesis-state.service.ts`,
   `src/index.ts`, `src/services.ts`. Removed the old tabs and the candidate stat strip; kept Library, pause,
   telemetry. Open clarifications:
   - G2 grep not zero: state still calls `listSuggestions` (`skill-synthesis-state.service.ts:~571`) because
     the orphan `skill-suggestions-view.component.ts` and `skill-synthesis-live.service.ts` (deleted in batch
     57) still use the state API and `tsconfig.lib.json` compiles all `src/**/*.ts`. Recommended: move the
     remaining state-API cut into batch 57 together with the orphan deletion (record as decision).
   - `apps/ptah-electron-e2e/src/specs/thoth/message-handlers-eager.spec.ts:6,32,61,79` still asserts the
     live push; give it to the e2e cleanup batch (never run e2e).
   - The candidate stat strip removal: batch 24a/O22 had just fixed that strip's layout; confirm the plan
     removes it (plan row 24 / line 119) - lane says yes. The Memory/Gateway/Cron strips stay.
   Gate (O20 included): `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui @ptah-extension/thoth-shell @ptah-extension/dashboard --parallel=1`.
   UI flag: Phase C visual review must show the new Skills tab (dark + light).
4. Uncommitted `decisions.md` row O23 (docs gap owner) and the three new reports.

## Open problems and decisions

1. Decisions this session: O16-O23 and U1-U4 in `decisions.md`. Key: O16/O22 user request - full-width Thoth
   panels + auto-fit stat grids (done); O17 telemetry reader prefers `skills.telemetry.enabled` (batch 44
   removes the fallback); O18 invocationStats/inject/guard; O20 shared-fake gate rule (now in Batch defaults);
   O21 thoth-shell spec contract; O23 `apps/ptah-docs/src/content/docs/cli/commands.md:186` (deleted CLI group)
   goes to the Phase F docs batch.
2. User decisions: U1 wizard keep/replace guard -> TASK_2026_701 (not 662); U2 per-workspace grades -> Task
   44.3 + Batch 59 (in batches.md); U3 approved removal of `routing-background-more` -> Task 25.2; U4 PNG
   screenshots stay on disk only (never `git add -f`).
3. Named Phase B follow-ups (not fixed, listed in batches.md): visual Serious 2-3 (pre-existing daisyUI/Thoth
   tile contrast), code M1, M3, M4, M5, r2-M1, r2-M2, visual Moderate 1-7, all Minor.
4. Deferred tasks 44.2, 65.2, 67.2, 53.2 (see batches.md).
5. Phase F needs the USER: OP-1 archive dry-run receipt on a COPY of the user DB before batch 68 (0057 drop);
   OP-2 snapshot-prune dry-run before applying. Ask before either.
6. Lanes: codex first (weekly ~30%+, confirmed room at last check). Glm only as fallback (stopped mid-read
   twice). Never grok (at 100%) or opencode (93% monthly). Max 3 lanes. codex resumes often start fresh
   (context > 60k) - always give full instructions. Lanes never run checks.
7. Electron is shared: before a launch, ListAgents + SendMessage "Electron: 662 launching, port 9390" to every
   peer, then "Electron: free". Port 9390, private APPDATA. Peer TASK_2026_699 uses 9391.
8. `~/.ptah/settings.json` has `skillSynthesis.enabled=false` (keep it).
9. Worktrees `skills-lane-messaging`, `skills-rubric-sweep`, `question-routing-e2e` stay until the user says to
   remove them (remove the node_modules junction with `cmd /c rmdir <wt>\node_modules` first). PR #756 and
   #759 are merged, so they are candidates to ask the user about.

## Follow-up tasks

- **TASK_2026_701_9e4b** (backlog, FEATURE, L, dependsOn TASK_2026_662_3eea): align setup-wizard agent
  generation with the skills Library. Folder `.ptah/specs/TASK_2026_701_9e4b/` is committed on
  `refactor/skill-synthesis-purge` (moved out of the main checkout at the user's request, ships with the 662
  PR). When work starts, create its own worktree from `main` after the 662 PR merges. Evidence:
  `TASK_2026_662_3eea/research/wizard-skills-harmony.md`. The TASK_2026_650 session confirmed it owns no
  wizard files now (650 merged as PR #763; 651 is analysis only).

## Key files

- Task folder: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea\`
  (`batches.md` with statuses + `### Next action`, `decisions.md`, `implementation-plan.md`, reviews
  `code-logic-review-phase-b*.md`, `visual-review-phase-b*.md`, `reports/batch-*-report.md`,
  `reports/phase-b-fix-*-report.md`, `research/wizard-skills-harmony.md`).
- Skills: `.claude/skills/orchestration/SKILL.md`, `.claude/skills/agent-lanes/SKILL.md`.

## Next steps (in order)

1. `git -C D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge status --short` (expect HEAD
   `147fd34c6`; modified `ipc-bridge.ts`, five skill-synthesis-ui files, `decisions.md`; new reports 25-1, 27, 31).
2. Record decisions for the 25.1 stop and the batch 27 clarifications (O24, O25) in `decisions.md`.
3. Gate batch 31, then batch 27 (one heavy check at a time; prefix `NX_NO_CLOUD=true`; filter with
   `grep -E "Running target|Tests:|Test Suites:|error TS|FAIL |●|Successfully|failed"`):
   - `npx nx run-many -t test typecheck -p ptah-electron @ptah-extension/cli-engine --parallel=1`
   - `npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui @ptah-extension/thoth-shell @ptah-extension/dashboard --parallel=1`
   Failures -> numbered `file:line` defects to a fresh codex lane with full instructions; re-run the gate.
4. Fresh `team-leader` Mode 2: commit batch 31 and batch 27 separately (foreground, specific files, never
   amend), then a docs commit (decisions.md, reports, batches.md incl. O23 owner, batch 27 partial status and
   the moved state-API cut into batch 57, the e2e spec owner, 25.1 stop).
5. Rerun Task 25.1 with a fresh codex lane including the chat handler + spec (per O24); gate
   `npx nx run-many -t test typecheck -p @ptah-extension/core @ptah-extension/chat @ptah-extension/memory-curator-ui @ptah-extension/setup-wizard --parallel=1`
   (add webview-e2e-harness only if it has a test/typecheck target). Then Task 25.2 (U3), then batch 28
   (thoth-shell fixture), batch 29 (core back-office), then the rest of Phase C per batches.md waves.
6. After the last Phase C batch: one code-logic review (Claude subagent, implementers codex) on the Phase C
   diff + visual review (port 9390, private APPDATA, tell peers) of the new Skills tab and the routing map;
   one fix round, short re-review, team-leader commits.
7. Phases D-F per batches.md; one code-logic review per phase. Ask the user before OP-1 / batch 68 and OP-2.
8. When TASK_2026_662 is complete: push `refactor/skill-synthesis-purge` in the background with
   `gh pr create`, report the PR link, set TASK_2026_662 and epic TASK_2026_639 `status: done` (status line only).

## Verification rules (memory-safe)

- Only changed projects: `npx nx run-many -t test typecheck lint -p <projects> --parallel=1`; confirm the header
  says "for N projects" with the requested N. Apply the O20 shared-fake rule.
- One spec: `npx jest -c <lib>/jest.config.ts <spec> --coverage=false --maxWorkers=2`.
- Never workspace-wide, build, serve, e2e or package unless the user asks. One heavy check at a time.
- `ptah-cli` gate runs > 10 min (36 dependency tasks): run it in the background.
- Under load, `voice-rpc.handlers.spec.ts` and `skills-sh-legacy-adoption.spec.ts` (rpc-handlers) can time out;
  re-run them alone before treating them as failures.
- Commit in the foreground only when no lane edits the worktree; push in the background.
- Commits: read `.commitlintrc.json`; subject <= 72, body lines <= 100; end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Lane state at handoff

- No lane or subagent is running. Last lanes: 25.1 `88188435` (stopped by rule, no edits), 27 `9620bc16`
  (partial, clarifications), 31 `fc0c5c80` (done). All need gating before commit (except 25.1).
