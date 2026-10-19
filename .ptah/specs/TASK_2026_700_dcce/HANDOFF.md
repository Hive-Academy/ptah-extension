# HANDOFF - TASK_2026_700_dcce Align the Voice page with the 678 prototype and app style

Written 2026-10-19 at the end of an orchestrator session (the user asked to wrap up at 43.8M
tokens). Session name for peers: `ptah-ptah-extension-task-697-voice-page-6627570000xs42qjcizfr0b`.

## Goal

The user finds the live Command Center Voice page "detached, very few icons, not following our
designs". They chose **"Match prototype + app style"**: bring the page to the look of the approved
TASK_2026_678 prototype (`.ptah/specs/TASK_2026_678_9083/prototype/command-center.html`) and align
it with the Chat and Tribunal pages. The user said of the rendered prototype states in
`C:/Users/abdal/AppData/Local/Temp/cc697/proto/` (dark-idle, dark-speaking, dark-approval,
light-speaking, light-24-nodes): **"something like that is awesome"**. Those PNGs are the target
look. A designer updates the prototype for the real app first; **the user approves it (Gate 1.7)
before any code**.

## Where

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/voice-prototype-align`, branch
  `feat/voice-prototype-align`, from `origin/main` `34095a98e` (contains PR #766). It has a
  `node_modules` junction to the main checkout (remove it with `cmd //c rmdir` before
  `git worktree remove`).
- Task folder: `.ptah/specs/TASK_2026_700_dcce/` in that worktree (task created with
  `ptah_task_create`, moved from the main checkout, `status: in_progress`).
- Nothing is committed. The branch is local only and has no remote yet.

## Done in this task

| Step | Result | File |
| --- | --- | --- |
| Context + Gate 0.1 | Recorded request, target look, rules, approval mode (`user` for Gate 1.7) | `context.md` |
| Parity inventory (codex lane, software-architect, inventory-only) | 39 capabilities of the current page with file:line, signals and tests; all `keep`, none remove-proposed | `parity-inventory.md` |
| Design (codex lane, ui-ux-designer) | Design spec with 39-row parity map, tokens, icon table, scene grammar, contrast, deviations; prototype updated from 678 with a start view, stats chips, context ring on the Ptah plate, speaker meter, Status button; 15 screenshots; helper scripts | `design-spec.md`, `prototype/command-center.html`, `prototype/README.md`, `prototype/screenshots/*.png`, `prototype/{build-prototype,capture-screenshots,check-contrast}.js` |
| Cross-side design review (Anthropic `ui-ux-designer` subagent) | **REVISE**: 2 Blocking (900px dock overlap, stats strip covers nodes), 4 Serious (current session duplicated in recent cards, invented "CC-2048" label, "Recorded" badge on every card, invented "History unavailable? Retry" banner), 5 Moderate (Completed/Idle card states without data, rail strings without source, unknown provider label rule, unmeasured plate/10px label contrast, list clipping/rail blank space), 3 Minor (new lucide icons need registering, Preview/Demo controls in captures, light Approve contrast) | `design-spec-review.md` |

## In progress at handoff

- **Revision round 1 of 2** - codex lane `ef6cffd2-896f-4505-9fc8-bd95cd60aa23` (fresh lane with a
  handoff brief; the old designer session `01a1513f-7746-7143-966a-e8e1a31c94ce` was too large to
  resume). Task: fix all 14 findings in `design-spec.md`, `prototype/command-center.html`,
  `prototype/README.md`, re-capture screenshots (add a 480px capture), and write
  `design-revision-1.md` (one row per finding). A context message is queued as its second turn
  (points it to `context.md`, `parity-inventory.md`, the target PNGs and its helper scripts).
  See "Status at end of session" below for its final state.

## Open problems and decisions

- Revise cap: at most 2 author/reviewer rounds. After round 1, re-review with a fresh Anthropic
  subagent writing `design-spec-review-r1.md`. If still REVISE after round 2, go to the user with
  the open items.
- Gate 1.7 approval mode is **user**: show the screenshots (dark + light: start, idle, speaking,
  approval, question, 24-nodes, narrow 900/480, tribunal-confirm) and wait for `APPROVED`.
- Data honesty rule from the review: show only what the app has (`ChatSessionSummary` in
  `libs/shared/src/lib/types/execution/node.ts`: providerId, name, messageCount (0 = not counted
  yet, hide), createdAt, lastActivityAt, tokenUsage, isActive, hasTranscript, livePhase).
- No `decisions.md` yet; create it at the architect step and log every decision.

## Standing user rules

- Orchestration + agent-lanes skills. Implement with codex CLI lanes (`ptah_agent_list` before
  every spawn, never an AT LIMIT lane). Parallel lanes run no nx/jest; a single lane may run
  scoped checks. Review shipping code with an Anthropic `code-logic-reviewer` subagent, one codex
  fix round per phase. Document gates use a cross-side reviewer (Anthropic subagent for codex
  authors).
- Memory-safe checks only: `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at a time, never
  workspace-wide; no build/serve/e2e except the Electron visual check.
- Run `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts` for every template
  change. Never `text-base-content/NN`. Degradation audit must stay at 294.
- Keep Canvas 2D radial layout and motion; no 3D libraries; lucide icons and GSAP allowed.
- Commit in the foreground with hooks (never `--no-verify`); scope `command-center` (plus
  `chat-ui` etc. if touched), `task-specs` for docs; read `.commitlintrc.json`. Push +
  `gh pr create` in the background. No local-only branches at the end.
- Electron: port 9334 only. Announce "Electron: <session> launching, port 9334" to every peer
  (ListAgents) first, send "Electron: free" after. Kill only your own PID tree. Build:
  `NX_DAEMON=false npx nx build-dev ptah-electron --parallel=1` then `copy-renderer-dev`, launch
  `NODE_ENV=development ./node_modules/electron/dist/electron.exe --remote-debugging-port=9334
  --use-fake-ui-for-media-stream --use-fake-device-for-media-stream dist/apps/ptah-electron/main.mjs`.
  Screenshot script: `C:/Users/abdal/AppData/Local/Temp/cc697/shot.js` (`node shot.js <prefix>
  start|scene`). Use the "Current" Command Center card; real delegated work needs paid turns -
  ask the user first.

## Key files

- Task: `.ptah/specs/TASK_2026_700_dcce/{context,parity-inventory,design-spec,design-spec-review}.md`,
  `prototype/`.
- Base design: `.ptah/specs/TASK_2026_678_9083/{design-spec.md,prototype/command-center.html}`.
- Previous polish (merged, PR #766): `.ptah/specs/TASK_2026_697_bae4/`.
- Code: `libs/frontend/command-center/src/lib/` - `components/command-center-page.component.ts`
  (+ `.controller.ts`), `command-center-start.component.ts`, `command-overlay.component.ts`,
  `command-node-detail.component.ts`, `command-work-list.component.ts`,
  `command-session-stats.component.ts`, `command-voice-hud.component.ts`,
  `scene/command-scene.component.ts`, `scene/command-scene-renderer.ts`, `scene/sprite-cache.ts`,
  `scene/scene-layout.ts`; tokens `apps/ptah-extension-webview/tailwind.config.js`.

## Exact next steps

1. Read this file, `context.md`, `design-spec-review.md` and (if written) `design-revision-1.md`.
2. Check lane `ef6cffd2-896f-4505-9fc8-bd95cd60aa23` once with `ptah_agent_status`. If it is still
   running, wait for its completion signal. If it failed or did not write `design-revision-1.md`,
   spawn a fresh codex `ui-ux-designer` lane with the same revision brief (all 14 findings in
   `design-spec-review.md`, deliverables `design-spec.md`, `prototype/command-center.html`,
   `prototype/README.md`, `design-revision-1.md`, re-captured screenshots incl. 480px).
3. Look at the new screenshots yourself (`prototype/screenshots/`).
4. Re-review with a fresh Anthropic `ui-ux-designer` subagent -> `design-spec-review-r1.md`
   (verify each finding; same checks as round 0). Round 2 only if REVISE; then the user.
5. **Gate 1.7**: show the user the dark + light screenshots and the deviations list; wait for
   `APPROVED`. Do not write code before that.
6. After approval: architect (codex `software-architect` lane) writes `implementation-plan.md`
   with file-disjoint phases and batches (header/surroundings, dock bar, rail/list, start view,
   canvas scene grammar: gold ring, dotted halo, plate under sphere, edge glow); cross-side
   review by an Anthropic subagent (Gate 2, lane-review notice). Then codex lanes implement per
   phase; one Anthropic `code-logic-reviewer` review + one codex fix round per phase; commit
   per phase.
7. Verify each phase in the worktree, one check at a time:
   ```bash
   cd /d/projects/ptah-extension/.claude-worktrees/voice-prototype-align
   npx nx typecheck command-center --parallel=1 --output-style=static 2>&1 | grep -E "error TS|Successfully ran|failed"
   npx nx lint command-center --parallel=1 --output-style=static 2>&1 | grep -E "✖|warning|Successfully ran|failed"
   npx nx test command-center --parallel=1 --output-style=static -- --maxWorkers=2 2>&1 | grep -E "Tests:|Test Suites:|FAIL"
   npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep Tests:
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must stay 294
   ```
   For several projects use `npx nx run-many -t test -p A B --parallel=1` (never positional).
8. Electron before/after visual check (dark + light) compared with the approved prototype; push
   + PR (background); fix CI and CodeRabbit comments; then ask the user about removing the
   worktree after merge.

## Status at end of session

- Revision lane `ef6cffd2-896f-4505-9fc8-bd95cd60aa23` **completed** (exit 0, both turns, verdict
  delivered). It wrote `design-revision-1.md` (14 rows, one per review finding, none marked open),
  updated `design-spec.md`, `prototype/command-center.html`, `prototype/README.md`, and
  re-captured 17 screenshots in `prototype/screenshots/` (adds `dark-480.png`, `light-480.png`).
- The lane's report claims all 14 findings are resolved and that composed plate, rail and Approve
  contrast pairs pass 4.5:1 in both themes. It also added helper scripts: `revise-spec.js` (task
  folder root), `prototype/revise-prototype.js`, `prototype/check-revision-contrast.js`. Decide
  whether to keep these scripts before the docs commit.
- The orchestrator has NOT yet looked at the revised screenshots or verified the fixes.
- Revision lane CLI Session ID: `01a15147-2bda-7da2-8fbc-f170ea837e0a` (pass it as
  `resume_session_id` for revision round 2; if the resume falls back to a fresh lane, give it
  the full brief again).
- No subagent or lane is running. Nothing is committed.
- So step 2 of "Exact next steps" is done; continue at step 3.
