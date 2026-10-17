# HANDOFF - TASK_2026_689_4d4f (and the tail of TASK_2026_687_615f)

Written 2026-10-17 at the end of an orchestrator session. Two tasks are open.

## 1. TASK_2026_687_615f - voice Command Center open issues (PR #747)

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/command-center-open-issues`
- Branch: `fix/command-center-open-issues`, remote head `bb5f877b1`, base `main` (PR #741 merged).
- PR: https://github.com/Hive-Academy/ptah-extension/pull/747
- Task folder: `.ptah/specs/TASK_2026_687_615f/` (`task.md` status `in_review`).

### Done

- Wave 1, Wave 2, logic review fix round (APPROVED 8.5), tab label "Voice" + mic icon.
- Visual fix round: Electron re-check APPROVED 9/10 (`visual-review.md`, round 2 section).
- Renderer `console.error` lines now carry message + source in the main log (`process-lifecycle-recorder.ts`).
- Console audit with real data: 0 renderer errors (`reports/console-audit.md`).
- Commit `bb5f877b1`: CI fix (banned `text-base-content/70` in `command-pending-input.component.ts`) and
  the 4 CodeRabbit comments (turn-status re-seed on bind, overlay focus handoff only from the pinned
  card, duplicate harness mock removed, recorder fallback no double context). Report:
  `reports/pr747-ci-fix-report.md`. One controller spec was adapted (`TestBed.tick()` after binding,
  `command-center-page.controller.spec.ts:389`) because binding and the terminal pulse cannot land in
  the same effect flush in the app.
- Local checks after `bb5f877b1`: command-center test 418 pass, typecheck + lint pass; ptah-electron
  typecheck pass, lint 0 errors (18 existing warnings); recorder spec 38 pass; webview
  `no-alpha-base-content.spec.ts` 11 pass. Degradation audit 294 (unchanged; checked before bb5f877b1).

### In progress / open

- CI on `bb5f877b1` was pending (2 pass, 13 pending) at handoff. Check it.
- CodeRabbit threads were not answered or resolved by hand; check whether CodeRabbit re-reviewed.
- Out-of-scope finding (not fixed): other setup hub cards (Tribunal icon 1.13:1, "AI Team Builder"
  CTA 1.25:1) fail light-theme contrast. Candidate for a separate task.
- Hardening idea (not done, case cannot happen with typed statuses):
  `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts:598-615` `STATUS_WORDS[...] ?? run.status`.

## 2. TASK_2026_689_4d4f - SVG/DOM Command Center scene redesign

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/command-center-scene-redesign`
  (has a `node_modules` junction to the main checkout for the git hooks).
- Branch: `feat/command-center-scene-redesign`, head `f7c3eb88f` (+ this handoff commit).
- Draft PR: https://github.com/Hive-Academy/ptah-extension/pull/749 (docs only).
- Task folder: `.ptah/specs/TASK_2026_689_4d4f/` (`task.md` status `in_progress`).

### Goal

Replace the canvas scene (`libs/frontend/command-center/src/lib/scene/*`, the overlay positioner and
label layout) with an SVG/DOM scene modeled on `references/reference-exposure-command-center.webp`:
core dial with big metric, curved connectors from a work-stream list, gradient ribbons to status
cards, ticked dial ring, glass cards. Animate only transform/opacity.

### Done

- `design-spec.md` + `prototype/index.html` (dark/light, 8/24 nodes, voice states, reduced motion),
  `design-revision-notes.md` (round 1 + round 2 tables), `design-review.md` (3 review rounds by an
  Anthropic visual-reviewer: 5.5 -> 7.5 -> 8/10). Revise cap reached.
- ngxui evaluated: `@omnedia/ngx-*` packages are MIT with Angular `^21.0.0` peers; repo is Angular 22
  -> build the effects locally with SVG/CSS, no new dependency.
- **User decision (Gate 1.7): "Approve with fixes"** - recorded in `context.md` § Design gate.
  The plan MUST close: N2 (hover preview grows the page by 187 px; reserve space only for a pinned
  plate and release it on close, Escape, outside click and selection change), M-R4 (ribbons run under
  cards in compact/stacked layouts), M-R5 (plate ~500 px from its row at 1440). The removal of the
  `canvasUnavailable` output and its fallback branch + tests is approved.
- Review screenshots live in `review/` and are git-ignored (local only). Best ones:
  `review/r3-dark-1100-24.png`, `review/r3-light-1440-24.png`.

### Next steps (exact)

1. Read `context.md`, `design-spec.md` (esp. "Preserve list / parity contract" and "Proposed
   Removals"), the round 2 section of `design-review.md`.
2. Write `implementation-plan.md` with a codex lane (run `ptah_agent_list` first; never an AT LIMIT
   lane; role `software-architect`; deliverable `implementation-plan.md`; at most 40 tool calls).
   The plan must include: the full preserve contract of the current scene (projection, 23-node cap
   and priority, selection, hover/pin, keyboard and roving focus, work-list focus, overflow split,
   voice ring 7 states, tribunal phase arc, lane satellites, reduced motion, theme feeds), the three
   open fixes above, file-disjoint batches, and the spec files to update or delete.
3. Plan review by an Anthropic subagent (opposite side: `software-architect` or `code-logic-reviewer`),
   writing `implementation-plan-review.md`; at most 2 revise rounds.
4. Implement with codex lanes (file-disjoint batches; lanes in parallel run no Nx/Jest).
5. Code-logic review by a different family (Anthropic subagent), one fix round.
6. Electron visual check vs the prototype, dark + light (rules below), screenshots shown to the user.
7. Commit per batch, push in the background, mark PR #749 ready.

### Verification commands (memory-safe)

```bash
cd /d/projects/ptah-extension/.claude-worktrees/command-center-scene-redesign
npx nx typecheck command-center --parallel=1 --output-style=static        # no --maxWorkers on typecheck
npx nx lint command-center --parallel=1 --output-style=static
npx nx test command-center --parallel=1 --output-style=static -- --maxWorkers=2
# several projects: npx nx run-many -t test -p A B --parallel=1 --maxWorkers=2 (check "for N projects")
npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must stay 294
gh pr checks 747
```

Filter output with `grep`/`tail`. One heavy check at a time.

## Standing user rules

- Orchestration + agent-lanes skills. Implement with codex CLI lanes (`ptah_agent_list` first, never
  AT LIMIT). Review with a different family (Anthropic subagent).
- Memory-safe checks only (above). No build/serve/e2e/package unless approved; the Electron visual
  check with `build-dev` + `copy-renderer-dev` was approved as part of the visual-check step.
- Read `.commitlintrc.json` before committing (scopes used: command-center, chat, chat-state,
  harness-builder, notification-center, electron, task-specs). Commit alone, in the foreground, with
  hooks, never `--no-verify`. Never commit the `.opencode/agent/` line the dev app adds to `.gitignore`.
  End commits with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, PR bodies with
  "🤖 Generated with [Claude Code](https://claude.com/claude-code)".
- Push in the background. No local-only branches.
- Electron: port 9334 only, never 9333 (684 uses 9335). Announce "Electron: <session> launching, port
  <n>" to the peer sessions (ListAgents) before launch and "Electron: free" after; wait if another
  session holds it. Kill only your own PID tree (`taskkill //F //PID <pid> //T`).
  Launch: `NX_DAEMON=false npx nx build-dev ptah-electron --parallel=1`, then
  `npx nx copy-renderer-dev ptah-electron --parallel=1`, then
  `NODE_ENV=development ./node_modules/electron/dist/electron.exe --remote-debugging-port=9334 --use-fake-ui-for-media-stream --use-fake-device-for-media-stream dist/apps/ptah-electron/main.mjs`.
- Stop and ask the user if a review finds lost main work, or Blocking/Serious items one fix round
  cannot close.
