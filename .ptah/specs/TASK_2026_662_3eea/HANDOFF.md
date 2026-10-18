# HANDOFF - Skills epic (TASK_2026_639 + TASK_2026_662) - 2026-10-18

## Goal

The user approved the full skills epic ("approved i would like to complete the full epic for the skills"):

- Epic TASK_2026_639 children: TASK_2026_644 (Council lane messaging) and TASK_2026_435 (prompt-authoring
  rubric sweep of the shipped skills).
- TASK_2026_662: delete the skill-synthesis pipeline in place, keep and fix the Library, add a success
  signal derived from task-folder reviews, archive then drop the pipeline data.
- Out of scope: epic TASK_2026_640 (harness-sync distribution), a later epic.

## Done

| Item | Branch / worktree | Commits | PR |
| --- | --- | --- | --- |
| TASK_2026_644 Council rounds reuse live lanes via `ptah_agent_message` | `docs/skills-lane-messaging` / `.claude-worktrees/skills-lane-messaging` | `c8056c476` | #756 **MERGED** |
| TASK_2026_435 rubric in skill-creator, 22 skills trimmed, Ptah brand moved to `docs/design-system/ptah-content-brand.md`, sibling-links guard widened to every plugin | `docs/skills-rubric-sweep` / `.claude-worktrees/skills-rubric-sweep` | `be39ee1b8`, `5dfc7cdd6`, `cdd0096fc`, merge `7c95b0e21` (content-manifest conflict resolved by regenerating) | #759 **OPEN**, CI was still running at handoff |

Both task.md statuses are `done` on their branches. Epic TASK_2026_639 `task.md` is `in_progress` (on the
644 branch, now in main); set it `done` when 662 is done (edit only the `status:` line).

TASK_2026_662 so far (branch `refactor/skill-synthesis-purge`, worktree
`D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge`, base `271198ced`, **no commits yet**):

- `context.md`: user decisions of 2026-10-18 (removals approved, both promoted skills removed, data drop
  approved, success rate from task-folder reviews) and decisions D1-D4 at the end.
- `implementation-plan.md` (codex architect, 2 revise rounds) + reviews `implementation-plan-review.md`,
  `-round-1.md`, `-round-2.md` (final verdict REVISE with R1-R6; user chose D4 "fold into decomposition").
- `batches.md` (team-leader Mode 1): 71 batches, phases A-F, plus OP-1/OP-2 manual data steps. R1-R6 folded in.
- `visual/before/before-shots.md` + 31 PNGs (dark/light) from the pre-purge build in
  `.claude-worktrees/646-after-shots`. Note: the lane rows live under Agent Orchestration > Background
  Model Roles, not Providers. Missing: light-theme agent-drawer element shot (full-window shot exists).

## In progress (uncommitted in the 662 worktree) - wave A-W1

| Batch | Executor | Files | State |
| --- | --- | --- | --- |
| 1 Migration 0056 nullable grades + 15 ratchet pins | codex | persistence-sqlite migrations (0056, index.ts, 15 `*.spec.ts` version pins) | Written, `reports/batch-1-report.md`. **Batch check NOT run yet.** |
| 2 Enhancement settings keys + raw settings migration | codex | platform-core `file-settings-keys.ts(+spec)`, `file-settings-manager.ts(+spec)` | Written; first check failed TS4111 at `file-settings-manager.ts:545-546`; fix round 1 done (bracket access), lane's `tsc --noEmit` passes. **Batch check must be re-run.** |
| 7 Nullable success-rate formatter guard | Glm | skill-synthesis-ui `clone-action-gating.ts(+spec)` | **Verified by orchestrator**: test + typecheck + eslint pass. Not committed. |

Codex CLI session IDs for resume (only within the lane idle/context limits, else start fresh):
batch 1 `01a1501a-66db-7691-af27-19ea68bab72d`, batch 2 fix round `01a1501e-d379-77e2-ba09-119d33c84006` (first turn was `01a1501a-7fc5-7173-8660-f71d05c9293a`);
Glm batch 7 `24d19266-51cf-4919-9071-538827abfd1a`.

No lane, subagent or Electron instance of this session is running. All batches in `batches.md` after
A-W1 are PENDING.

## Open problems and decisions

1. `batches.md` statuses: batches 1, 2, 7 are `IN_PROGRESS`; the team-leader (Mode 2) updates them and
   commits. Only the orchestrator/team-leader edits `task.md` / `batches.md` statuses.
2. Batch 7 has no visible UI change until batches 8/22 land (DTO field still `number`).
3. UI batches needing after-screenshots (dark + light, compare with `visual/before/`): 7, 11, 17, 18, 19,
   20, 21, 23, 24, 27, 57, 65, 71. Persisted-write batches needing a write-path trace: 1, 2, 3, 4, 5, 6,
   10, 15, 16, 17, 19, 20, 21, 49, 50, 65, 67, 68, 70.
4. One code-logic review per phase on the combined diff. Implementers are codex + Glm, so the
   team-leader picked the in-process Claude `code-logic-reviewer` as the third family.
5. Phase F needs the user: OP-1 runs the archive export on a COPY of the user DB and shows the receipt
   (table list, row counts, sha256, path); batch 68 (0057 drop) is not committed until the user confirms.
   OP-2 shows the snapshot-prune dry-run before applying. Tables to drop (approved): `skill_candidates`,
   `skill_suggestions`, `skill_synthesis_queue`, `skill_synthesis_budget`, `skill_invocations`, the skill
   jobs' `job_runs` rows, `skill_synthesis_workspace_cursor`, `skill_candidates_vec` (D3). Keep user-edit
   snapshots (revert needs them). Keep `skillSynthesis.enabled=false` in `~/.ptah/settings.json`.
6. Team-leader decisions in `batches.md`: `LaneRunnerService` + its token stay (enhancer and bench doubles
   use them; later follow-up); new `scripts/export-skill-pipeline-archive.ts` (batch 50).
7. Lanes: codex confirmed room (weekly 17% at handoff); Glm (ptah-cli `pc-355b645d-35af-4974-84cf-9cf961ea0164`,
   modelTier opus) works; **avoid grok (98% weekly) and opencode (93% monthly)**. Max 3 lanes.
8. Lane rule used this session: lanes only write code and do NOT run checks; the orchestrator runs each
   batch's single scoped check, one heavy check at a time, then resumes the lane with file:line defects.
9. Line endings: Glm/codex can write CRLF. Before committing, strip CR from staged files
   (`tr -d '\r'`) - `content-manifest` hashes break otherwise (skill files only).
10. Electron is shared with peer sessions: before a launch, `ListAgents` + `SendMessage`
    "Electron: <task> launching" to every peer, then "Electron: free". Never port 9333. Use a private
    APPDATA (dev mode forces `%APPDATA%\Ptah Dev`, `apps/ptah-electron/src/main.ts:52-55`). Subagents cannot
    reach peers - relay for them.
11. Worktrees `skills-lane-messaging` (PR merged) and `skills-rubric-sweep` stay until the user says to
    remove them. Remove a node_modules junction with `cmd /c rmdir <wt>\node_modules` BEFORE
    `git worktree remove`.

## Key files

- Task folder: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea\`
  (`context.md`, `implementation-plan.md`, `implementation-plan-review-round-2.md`, `batches.md`,
  `reports/batch-{1,2,7}-report.md`, `visual/before/`).
- Approved removals: `.ptah/specs/TASK_2026_659_cec4/parity-inventory.md` (remove-proposed rows) + D2/D3.
- Lane skills: `.claude/skills/orchestration/SKILL.md`, `.claude/skills/agent-lanes/SKILL.md`.

## Next steps (in order)

1. `git -C D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge status --short` (expect batch
   1, 2, 7 files + task folder changes, no commits beyond `271198ced`).
2. Run the two pending batch checks, one at a time (prefix `NX_NO_CLOUD=true`, filter output):
   - `npx nx run-many -t test typecheck -p @ptah-extension/persistence-sqlite --parallel=1`
   - `npx nx run-many -t test typecheck -p @ptah-extension/platform-core --parallel=1`
   On failure, resume the codex lane (or start a fresh one with the batch section + report path) with
   numbered `file:line` defects.
3. Fresh `team-leader` in Mode 2 with the three report paths; it verifies, updates `batches.md`, and
   commits each batch in the foreground (scope e.g. `refactor(persistence-sqlite): ...`; read
   `.commitlintrc.json`; subject <=72 chars, body lines <=100). Never commit while a lane edits the worktree.
4. Continue waves in `batches.md` order (its `### Next action:` line). Phase review after each phase.
5. Check PR #759 CI: `gh pr view 759 --json statusCheckRollup,mergeStateStatus`. On a failure, read
   `gh run view <id> --log-failed`. Known: `electron-e2e` shard 2/4 fails in
   `apps/ptah-electron-e2e/src/specs/harness/new-project-question-routing.spec.ts:112` (expects 1 question
   element, gets 2). It failed on #756 (docs-only, already merged) and again on its rerun (run
   39142508736), so it is NOT a flake. It is unrelated to the skills work; likely a `main` break from
   the TASK_2026_687 command-center/harness changes. If #759 fails only on that test, tell the user and
   propose a separate fix branch (`fix/question-routing-e2e`) instead of changing #759.
6. When 662 is complete: push the branch in the background, open its PR, set TASK_2026_662 and epic
   TASK_2026_639 `status: done` (status line only).

## Verification commands (memory-safe; never workspace-wide; one heavy check at a time)

- One project: `npx nx run-many -t test typecheck -p <project> --parallel=1`
- Several: `npx nx run-many -t test -p A B --parallel=1` (confirm "Running target test for N projects")
- One spec: `npx jest -c <lib>/jest.config.ts <spec> --coverage=false --maxWorkers=2`
- Skill files: `npm run manifest:generate` then `npm run manifest:check`
