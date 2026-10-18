# HANDOFF - TASK_2026_691_1da5 (and the close of TASK_2026_689 / 687)

Written 2026-10-17 at the end of an orchestrator session (token budget reached).

## State of the related tasks

| Task | Branch / worktree | PR | State |
| --- | --- | --- | --- |
| TASK_2026_687_615f (voice Command Center open issues) | `fix/command-center-open-issues`, `.claude-worktrees/command-center-open-issues` | #747 | **MERGED** 2026-10-17 18:33 (`7bdc6eed4` on main). Worktree still exists; the user did not yet say to remove it. |
| TASK_2026_689_4d4f (SVG/DOM scene redesign) | `feat/command-center-scene-redesign`, `.claude-worktrees/command-center-scene-redesign` (head `c1b4c3a82`, pushed) | #749 | **CLOSED unmerged** by user decision. `task.md` status `cancelled`. Kept as a reference only. |
| TASK_2026_691_1da5 (this task) | `fix/command-center-provider-marks`, `D:/projects/ptah-extension/.claude-worktrees/command-center-provider-marks` (from main `7bdc6eed4`; has a `node_modules` junction) | none yet | **In progress** (see below). Nothing committed on this branch yet. |

## Why 689 was reverted

The user looked at the SVG/DOM scene in the running Electron app and said: "the previous canvas
view was much better". What they like in the canvas: the **radial layout** and the
**motion/animation**. They chose "Revert + small PR": keep the canvas on `main`, take only the
transferable parts into TASK_2026_691. The 689 visual review was stopped (not needed).

## Goal of TASK_2026_691

On top of the canvas scene (do NOT change the canvas renderer, sprites, layout or motion):

1. **Provider marks for every session** (user: "make sure for each session to show proper provider
   icon"). Use `ptah-provider-mark` (`@ptah-extension/ui`, brand art via `PROVIDER_BRAND_SLUGS`,
   `libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.ts:74`) for known providers and
   `ptah-monogram-tile` for unknown ones, in every place that shows a session provider. On main
   the overlay plate (`components/command-overlay.component.ts:102`) and the work list
   (`components/command-work-list.component.ts:49`) already do this. Gap: the root session gets
   its provider only from `liveModelStats.contextCapacity.providerId`
   (`components/command-center-projection.source.ts:208`), so a restored session without live
   statistics shows no provider -> add a fallback from the tab's own provider data. Also check that
   CLI agents (`CLI_PROVIDER_MARK_IDS`, `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-marks.ts`)
   and SDK subagents never become "unknown".
2. **Lucide state icons + visible state word** in the DOM plate and work list (user asked for real
   icons): completed `CircleCheck`, failed `CircleX`, cancelled `Ban`, awaiting input
   `MessageCircleQuestion`, running/starting `LoaderCircle` (transform-only rotation, static in
   reduced motion), queued/idle/unknown `CircleDashed`; icon `aria-hidden`. `lucide-angular` is an
   existing dependency.
3. **Overlay fixes from the 689 review that also apply to the old overlay** (check each on main
   first): pin outlives its node; Escape does not close the hover preview; `aria-expanded` without
   `aria-controls`; hover preview grows the page (N2). Fix only those that apply.

Scope details: `.ptah/specs/TASK_2026_691_1da5/context.md` (this folder).

## In progress at handoff

- Codex lane `14d625ab-2b3a-44d4-97bd-741d3258fc24` (role frontend-developer) implemented items
  1-3 in the 691 worktree (uncommitted) and wrote `implementation-report.md` in this folder. No
  lane or subagent is running now. Next: orchestrator verification, review, commit, PR.

## Lane result

The codex lane finished its work and wrote `implementation-report.md` (this folder). Its claims
are NOT yet verified by the orchestrator, and nothing is committed.

- Uncommitted changes in the 691 worktree (all in `libs/frontend/command-center/src/lib/components/`):
  `command-center-page.component.ts`, `command-center-projection.source.ts` (+ spec),
  `command-overlay.component.ts` (+ spec), `command-work-list.component.ts` (+ spec), new
  `command-state-icon.ts` (shared Lucide state icon map). Plus the untracked task folder.
- Lane-reported checks: typecheck + lint pass; command-center 40 suites / 422 tests pass.
- Overlay audit on main: pin outlives node = applies (fixed); Escape leaves hover preview =
  applies (fixed, reopening suppressed until hover ends); `aria-expanded` without
  `aria-controls` = applies (fixed, points to `command-node-card`); hover preview grows page =
  NOT applicable (canvas overlay wrapper is absolutely positioned).
- No canvas renderer / sprite / layout changes (lane claim - verify with `git diff --stat`).

## Decisions (user, 2026-10-17)

- ngxui: not used; local SVG/CSS only (moot after the revert).
- Revert 689; keep canvas; small PR for transferable parts (this task).
- Follow-up task AFTER this one (not started; recorded in
  `.claude-worktrees/command-center-scene-redesign/.ptah/specs/TASK_2026_689_4d4f/context.md`
  section "Follow-up task"): (a) Command Center initial state with "New session" / "Load
  previous" - today `CommandCenterSessionCoordinator.openOrResume()`
  (`libs/frontend/command-center/src/lib/model/session-coordinator.ts:55-145`) auto-picks the
  active tab, else the last session, else a new tab, and only a "New session" button exists;
  (b) a persona voice rule - the persona (`libs/frontend/chat-state/src/lib/command-center-persona.ts:30`)
  has no spoken-reply rule, and `toSpokenText()` (`libs/frontend/command-center/src/lib/voice/spoken-text.ts`)
  speaks the first 4 sentences / 600 chars of the last assistant message; add "start each reply with
  1-2 plain spoken sentences that give the answer, details after".

## Open items

- Light-theme contrast of other setup hub cards (Tribunal icon 1.13:1, "AI Team Builder" CTA
  1.25:1) - candidate for a separate task (from 687).
- Ask the user whether to remove the merged 687 worktree
  (`git worktree remove .claude-worktrees/command-center-open-issues`) and the 689 worktree.

## Exact next steps

1. Read this file, `context.md` and `implementation-report.md` in this folder.
2. Read the lane diff (`git diff`, `command-state-icon.ts`) against the three scope items; confirm
   that `git diff --stat` touches no `scene/` canvas file. Lane id for a resume if needed:
   `14d625ab-2b3a-44d4-97bd-741d3258fc24`, CLI Session ID `01a14b31-800f-7ff1-863e-2f91a0231eb3`
   (pass it as `resume_session_id` for the fix round; the lane ended `completed`, verdict `delivered`).
   Run `ptah_agent_list` before any spawn; never an AT LIMIT lane.
3. Verify in the 691 worktree (one heavy check at a time):
   ```bash
   cd /d/projects/ptah-extension/.claude-worktrees/command-center-provider-marks
   git status --short
   npx nx typecheck command-center --parallel=1 --output-style=static 2>&1 | grep -iE "error TS|Successfully ran|failed"
   npx nx lint command-center --parallel=1 --output-style=static 2>&1 | grep -E "✖|warning|error |Successfully ran|failed"
   npx nx test command-center --parallel=1 --output-style=static -- --maxWorkers=2 2>&1 | grep -E "Tests:|Test Suites:|●"
   npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep Tests:
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must stay 294
   ```
   If the lane changed another project (e.g. chat-state), run that project's typecheck/test too.
4. Code-logic review by an Anthropic subagent (`code-logic-reviewer`, different family from codex),
   writing `code-logic-review.md` here; one fix round max. Stop and ask the user if Blocking/Serious
   items remain after one fix round.
5. Read `.commitlintrc.json`; commit in the foreground with hooks (scope `command-center`, plus
   `task-specs` for docs); end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
   Never commit the `.opencode/agent/` line the dev app adds to `.gitignore`.
6. Push in the background chained with `gh pr create` (body ends with
   "🤖 Generated with [Claude Code](https://claude.com/claude-code)"). No local-only branches.
7. Electron visual check, dark + light, before/after screenshots of the plate and work list
   (before = main). Port 9334 only (never 9333/9335/9370). Announce
   "Electron: <session> launching, port 9334" to the peer sessions (ListAgents) first, wait if
   another session holds it, and send "Electron: free" after. Kill only your own PID tree
   (`taskkill //F //PID <pid> //T`). Launch:
   `NX_DAEMON=false npx nx build-dev ptah-electron --parallel=1`,
   `npx nx copy-renderer-dev ptah-electron --parallel=1`,
   `NODE_ENV=development ./node_modules/electron/dist/electron.exe --remote-debugging-port=9334 --use-fake-ui-for-media-stream --use-fake-device-for-media-stream dist/apps/ptah-electron/main.mjs`.
   Show the screenshots to the user.
8. Then start the follow-up task (session picker + voice rule) in its own worktree.

## Standing user rules

- Orchestration + agent-lanes skills. Implement with codex CLI lanes (`ptah_agent_list` first,
  never AT LIMIT; codex weekly was 76% at handoff). Review with a different family (Anthropic
  subagent). Lanes in parallel run no Nx/Jest; a single lane may run the scoped checks.
- Memory-safe checks only: `--parallel=1`, Jest `--maxWorkers=2`, no build/serve/e2e/package
  except the approved Electron visual check, never workspace-wide.
- Commit alone in the foreground with hooks, never `--no-verify`; push in the background.
- Stop and ask the user on lost main work or Blocking/Serious items one fix round cannot close.
