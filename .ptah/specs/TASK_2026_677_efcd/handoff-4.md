# TASK_2026_677_efcd — HANDOFF 4

> File name: `handoff-4.md`. NEVER write `HANDOFF.md` (user rule; it overrides the session-budget banner, decisions
> row 8). The next handoff is `handoff-5.md`.
> Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view`, branch `feat/clean-session-view`
> (from main `c57a9a1e7`). Origin has commits up to `5ed660524`. Everything after it is LOCAL ONLY (not pushed), no PR yet:
> `3693f9227 a3ab54448 bfc3c3819 4fd86f186 85ad9b60f a8835885d 2e273fd3c dde4204b7 bc513eb5a 34776d93d 198992dd6`
> plus the handoff-4 commit (delta 3 docs + this file). The PR is opened at the end of the task (push + `gh pr create`).

## 1. Goal

Clean session view, one-to-one with `reference/01-clean-chat-turns.png` and `reference/02-session-shell-with-inspector.png`:
clean turn (work log → "Worked for Xm Ys ›" disclosure, final answer, agent chips, copy + activity actions, live line),
"This session" inspector, header + composer chips, staggered session-switch animation, T1 carry-over, delta 2 agent dock
(option B) with provider marks / role icons, and NEW delta 3: the session stats strip, its expanded panel and the
background-agent tray leave the main chat column and move into the inspector (limits as tiles with bars/rings, model only
in inspector stats). Frontend only.

User rules: Claude (orchestrator + Claude sub-agents) builds the frontend; CLI lanes only REVIEW. Approval mode lane-review
(codex APPROVED passes Gates 1, 1.7, 2). Ask the user only for removals, scope or irreversible actions. Testing postponed
(no new spec files); existing suites, typecheck and lint of every changed project still run. lucide-angular icons;
`ptah-provider-mark` CLI marks.

## 2. Done (session 4)

- User decisions: row 43 one webview bundle build allowed after the last Part B batch (BUILD-1); row 44 empty TASK
  section renders nothing (D27); row 45 removal R1 approved (assistant avatar + "Claude" + time line; parity B-25).
- `implementation-plan.md` merged from parts A1/A2/B/C (419 lines). Gate 2: codex REVISE 7/10 (row 47) → architect-r1
  fixes (serialized barrels, per-item `.st-t` stagger, req 17.6) → codex `implementation-plan-review-r1.md` APPROVED 9/10
  (row 49). **Gate 2 PASSED.** Commit `2e273fd3c`.
- `SESSION_WORKFLOW_ADDONS` registry token contract sent to the 648/652 session (plan §7.2).
- Before screenshots: `visual-before.md` + 60 PNGs `screenshots/before/` (git-ignored; row 48).
- `batches.md` (team-leader MODE 1): 18 batches, 8 waves (W1 C-1,B-1,B-2 · W2 C-2,A1-1,A1-4 · W3 B-3,C-3,A2-1 ·
  W4 A2-2,A1-2,B-4 · W5 A1-3,CV-1 · W6 CV-2,B-5 · W7 CV-3 · W8 BUILD-1). Verify + commit once per wave (row 51).
- **Wave 1 COMPLETE** (MODE 2, 6 projects typecheck/lint/test green): C-1 `dde4204b7`, B-1 `bc513eb5a`, B-2 `34776d93d`,
  batches.md `198992dd6`. Row 52: B-2 named DocFile constants in `libs/shared/.../task-spec.contract.ts`.
- Row 53: git-ignored `node_modules` JUNCTION in the worktree → `D:\projects\ptah-extension\node_modules` (same
  package.json/lock as main). Needed for Jest/renderer. Keep for the task; remove before removing the worktree.
- **Delta 3** (user request, rows 50, 54): PM wrote req 21 (28 criteria), PM-17..PM-21, parity C-2..C-6 → move,
  C-19..C-50, C-48b. User: keep composer model/effort selector as the control; tray merges into AGENTS, no "other
  sessions" group. Designer wrote design-spec "Delta 3" + D44-D56, prototype `delta3.js/css`, `contrast-delta3.mjs`,
  `DELTA-3-NOTES.md`, capture checks 200 PASS / 0 FAIL (row 56).
- 648 coordination (row 55): 648 is complete locally on `feat/task-648-session-embed` (commits b17ba660d, db30cc25d,
  8e732999a, a3b4a82f9, 8a5417416), stacked PR not yet open. Extra overlaps: canvas-lane-view.component.spec.ts,
  chat-view.component.spec.ts, canvas-focus-header.component.{ts,spec.ts} (whole-file reformat), chat/services/index.ts.
  We replied: no blocker; prefer 648 merges before W3 (C-3) and W5 (CV-1) so 677 rebases once.

## 3. Open at handoff (no agent or lane is running)

1. **Gate 1.7 delta 3 = REVISE 6/10** (`design-spec-review-delta3.md`, row 57). Revise round 1 of 2 NOT started:
   - Serious 1: lane-only limit warnings vanish when the inspector is closed (header chip reads only `limits.indicator`,
     design-spec ~1510-1513, 1559-1560) → derive the closed-state cue from window AND lane limit states.
   - Serious 2: D56 REJECTED as written — sub-agent model goes ONLY into its inspector AGENTS entry (not the dock hover
     card), define the data path (`inline-agent-bubble.component.ts:889-904`).
   - Serious 3: moved tooltips (context/token/cost/agents tiles, design-spec ~1433-1442) are hover-only → keyboard/
     focus access (e.g. disclosure or focusable tile with described-by).
   - Moderate 4: unknown context: match today's strip (em dash percent, no used tokens when capacity unknown).
   - Moderate 5: C-48b still "pending" in `task-description.md:947-949` and `parity-inventory.md:142` → mark settled by
     row 54.
   - Minor 6: prototype omits specified states (status/evidence/cooldown tiles, cost-budget bar) — draw if cheap.
2. **Plan delta for delta 3 not written.** After Gate 1.7 delta 3 passes: architect writes `plan-part-d-stats.md`
   and merges it into `implementation-plan.md` (affects B-4 inspector tree, CV-1 chat-view shell — remove
   `ptah-session-stats-summary` mount `chat-view.component.html:42` and `ptah-background-agent-tray` mount `:60`;
   orchestrator card model line; inline-agent-bubble model label; header limit chip in A2/CV-2) → codex Gate 2 delta
   review → team-leader MODE 1 update of batches.md (new/changed batches). MUST land before Wave 4 (B-4) and Wave 5 (CV-1).
3. **Wave 2 (C-2, A1-1, A1-4)** is marked IN_PROGRESS in batches.md but NOT started (no executor ran). It does not
   touch delta 3 files; it can start in parallel with the delta 3 revise round.
4. TASK_2026_648 not merged; check before W3 (C-3 edits canvas-lane-view) and W5.

## 4. Decisions to know (decisions.md rows 1-57)

18-23 duration/inspector rules and user decisions; 30-38 delta 2; 34-36, 42, 55 coordination with 648; 39 follow-up
TASK_2026_679; 40-41 plan split; 43-45 user decisions (build, empty TASK, R1); 47/49 Gate 2; 48 before screenshots;
50/54 delta 3 user requests; 51 batches; 52 B-2 constants; 53 node_modules junction; 56/57 delta 3 design + review.

## 5. Exact next steps

1. Read this file, then `decisions.md` rows 43-57, then `design-spec-review-delta3.md` (46 lines). Do not read the
   plan parts or design-spec whole (offset/limit only).
2. In parallel (file-disjoint):
   - Delta 3 revise round 1: fresh Claude `ui-ux-designer` (design-spec.md Delta 3 + prototype; ~120k budget,
     write-early) and, for finding 5, a small PM edit (task-description.md, parity-inventory.md). Then a FRESH codex lane
     (resume is refused above 60k context) re-reviews → `design-spec-review-delta3-r1.md`. Max 2 revise rounds; then the
     user.
   - Wave 2: spawn three Claude `frontend-developer` sub-agents (C-2, A1-1, A1-4) with the prompt template from the
     team-leader's MODE 2 return (in batches.md "Wave rule") + each batch's "Executor notes (STRICT)" block; each writes
     `reports\batch-<id>.md`. Then a fresh team-leader MODE 2 with the three report paths.
3. After Gate 1.7 delta 3 passes: `software-architect` → `plan-part-d-stats.md` + merge into implementation-plan.md
   (~120k budget, write-early) → fresh codex Gate 2 delta review (`implementation-plan-review-delta3.md`) → team-leader
   MODE 1 (update batches.md: add delta 3 batches, adjust B-4/CV-1/CV-2/A1-3 ownership).
4. Wave 3 (B-3, C-3, A2-1) → W4 → ... → W8 BUILD-1 (one webview bundle build, row 43:
   `node .ptah/tmp/check-run.mjs webview-bundle -- npx nx build ptah-extension-webview --parallel=1 --skip-nx-cache`,
   compare to the 3.5 MB error budget). Fresh team-leader MODE 2 per wave.
5. Phase review: codex code-logic review of the phase diff (`code-logic-review.md`; include a style check of new public
   exports) → one fix round → `visual-reviewer` dark + light vs `prototype/` and `screenshots/before/` (Electron renderer
   rebuild only; the junction must exist) → final commit.
6. Before push: check TASK_2026_648; rebase onto main after it merges (resolve per row 55; apply plan §7.4 H1-H3).
   Then push + `gh pr create` as ONE background command; PR body ends with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
7. Verification (per changed project, one at a time, from the worktree root):
   ```
   node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t typecheck -p <projects> --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t lint -p <projects> --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t test -p <projects> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs proto-checks -- node .ptah/specs/TASK_2026_677_efcd/prototype/assets/capture.mjs checks
   ```
   Confirm the header "Running target X for N projects" equals N. Project names are `@ptah-extension/chat`,
   `@ptah-extension/chat-ui`, `@ptah-extension/ui`, `@ptah-extension/tasks-ui`, `@ptah-extension/shared`,
   `@ptah-extension/task-specs`, `ptah-extension-webview` (verify others: chat-streaming, canvas, chat-state).

## 6. Key files

- Task folder: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\.ptah\specs\TASK_2026_677_efcd\`
  - `task-description.md` (req 21 = delta 3), `parity-inventory.md`, `design-spec.md` (Delta 3 section, D44-D56),
    `decisions.md`, `implementation-plan.md` + `plan-part-{a1-turn,a2-header,b-inspector,c-agents}.md`, `batches.md`,
    `reports/batch-*.md`
  - reviews: `implementation-plan-review.md`, `implementation-plan-review-r1.md`, `design-spec-review-delta3.md`
  - `prototype/index.html`, `prototype/assets/{app,delta3}.{js,css}`, `capture.mjs`, `DELTA-3-NOTES.md`
  - `visual-before.md`, `screenshots/before/` (git-ignored)
- Delta 3 product touch points: `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:42,60`,
  `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.*`,
  `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/*`,
  `libs/frontend/chat/src/lib/components/organisms/background-agent-tray.component.ts`,
  `inline-agent-bubble.component.ts` (model label). Keep the components for harness-builder and canvas-lane-view.

## 7. Rules (repeat in every lane and sub-agent prompt)

Never kill processes by image name (stop only own PIDs); give designers/architects a context budget (~120k, write the
deliverable early and extend it per section, offset/limit reads, <= 2-3 PNG views) and split large work into
file-disjoint agents; codex resume is refused above 60k context → give fresh lanes complete briefs. Checks only via
`node .ptah/tmp/check-run.mjs <label> -- <command>`; changed projects only, `--parallel=1 --skip-nx-cache`, Jest
`--maxWorkers=2`; one heavy check at a time (never push while a check or build runs); no workspace-wide runs; no
build/serve/dev/e2e/package except the Electron renderer rebuild and BUILD-1; no npm install; no git in
`D:\projects\ptah-final-run-ws`; UI changes need before/after screenshots dark + light; commits foreground, explicit
paths, `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, ending
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR body ends with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`; at most 3 parallel CLI lanes; handoff files are
`handoff-N.md`, never `HANDOFF.md`. End each turn with a short summary of what is done and what is left.
