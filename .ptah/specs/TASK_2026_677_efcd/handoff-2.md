# TASK_2026_677_efcd — HANDOFF 2

> File name: `handoff-2.md`. NEVER write `HANDOFF.md` (user rule). The next handoff is `handoff-3.md`.
> Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view` — branch `feat/clean-session-view`
> (from main `c57a9a1e7`). Pushed to origin earlier (commits up to `5ed660524`); commits `3693f9227` and `a3ab54448`
> are LOCAL ONLY (not pushed). No PR yet.

## 1. Goal (unchanged from handoff-1.md §1, plus user scope adds)

Clean session view, one-to-one with `reference/01-clean-chat-turns.png` and `reference/02-session-shell-with-inspector.png`:
clean turn (live work log → "Worked for Xm Ys ›" disclosure, final answer, agent chips, copy + activity actions, live
line), "This session" inspector (orchestrator card, AGENTS, TASK, TODOS, GIT), header + composer chips, staggered
session-switch animation, T1 carry-over (`reference/pr730-followup-map.md`).

User scope adds this session:
- **TASK section** in the inspector (decisions row 21): linked primary task (session:linkTask / organization taskIds),
  ID, title, status (outline pill, TASK_STATUS_LABELS), derived Stage, artifact links opened like the git sidebar opens
  files, live refresh on `tasks:changed`. design-spec §4.6, D27-D33; task-description req 17.
- **Delta 2** (row 27): agent tiles with real icons (CLI lanes via `ptah-provider-mark`, sub-agents via lucide role
  icons, not `>_` / `◇`), and a redesigned thread switcher (`libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts`,
  the only main-view switch between orchestrator, sub-agents and CLI lanes) that shows who is active and that items are
  clickable. The user wants to CHOOSE between options.

User rules: Claude (orchestrator + Claude sub-agents) builds the frontend; CLI lanes only REVIEW. Approval mode
lane-review; ask the user only for removals / irreversible actions / scope. Testing postponed (no new spec-writing);
existing suites, typecheck, lint of each changed project still run. lucide-angular icons + `ptah-provider-mark`.

## 2. Done (this session)

- Housekeeping (handoff-1 §6): 629 worktree removed (clean; branch `feat/task-629-canvas-board` kept);
  `D:\projects\ptah-s13-empty-ws` deleted (16 Ptah config files, no git). 628 note: TASK_2026_628 is done; the note
  belongs to **TASK_2026_645_6aaa** (status `blocked` on "629 merged" = now satisfied; its `context.md:45` still cites
  removed `ptah-canvas-tile` / `gridstack-item` → M-final must use the Rail board). User was told to open
  `/orchestrate TASK_2026_645_6aaa` in a new session with that note. T3-T6 folders: left open (user).
- PM: `task-description.md` (17 requirements) + `parity-inventory.md` (69+ rows, T-1 added). **No removals.**
- **Gate 1 PASSED by the user** (row 22) after codex REVISE 6/10 at the cap + orchestrator correction (row 20:
  single-message turns show a separate `Message duration` item).
- Design rounds 1 + 2 + delta 1: `design-spec.md` (§4.6 TASK, §8.2 status inks for 34 themes, decisions D16-D33,
  "Revision round 1/2" + "Delta 1" tables), `prototype/` (index.html, assets/app.js/app.css/capture.mjs/
  contrast-check.mjs/sprite-extra.js/tokens.css; ROUND-1-NOTES.md, ROUND-2-NOTES.md, DELTA-1-NOTES.md;
  `capture.mjs checks` 122 PASS / 0 FAIL; contrast 34/34 themes; 79 screenshots, git-ignored).
- User decisions: B-8/B-11/B-12 badges behind "Show activity" APPROVED; B-16 user-turn time + "You" stay visible at
  rest; B-14/B-15 Branch/Rewind keep today's hover reveal (user declined focus reveal → known WCAG 2.4.7 limitation,
  recorded, do not re-open unless the user asks).
- Commits (local): `3693f9227` (design round 1 + requirements), `a3ab54448` (round 2, delta 1, Gate 1 pass).
- Reviews: design-spec-review.md (r0 5/10), design-spec-review-r1.md (7/10), task-description-review.md /
  -r1.md / -r2.md.

## 3. In progress / open at handoff

- **Gate 1.7 PASSED (lane-review) for design round 2 + delta 1:** codex `design-spec-review-r2.md` APPROVED 9/10, no
  Blocking/Serious (capture checks exit 0; contrast 34/34). Its "Architect checks" §: (1) the organization link shape is
  `organization.tasks[]` with `taskId`, `role`, `createdAt`, `missing` (`session-organization.types.ts:91-100,115-126`),
  not `taskIds`; VS Code may report `organizationAvailable: false` (`rpc-session.types.ts:118-128`); verify link-change
  refresh. (2) Open path: `editor:openFile` exists (`rpc.types.ts:872-875`); the git launcher calls it with
  `{target, workspaceRoot, path}` (`libs/frontend/git-ui/src/lib/services/editor-launcher.service.ts:138-149`); choose
  the target, verify path authorization per host. (3) Own `tasks:changed` subscriber independent of
  `TasksStoreService.surfaceOpen`; narrow entry point for tasks-ui presentation helpers; no board in the chat bundle.
  (4) Install per-theme tokens + extend the contrast guard spec; verify per-message fields after reload; Stage helper
  location; contrast of the reduced-opacity user-turn time.

- **Delta 2 options READY, user choice NOT yet asked** (designer-delta2 finished): `design-delta-2-options.md` (options,
  icon system, ASCII previews, recommendation), `prototype/options-delta-2.html` + `assets/delta2.css`, `delta2.js`,
  `delta2-sprite.js`, `gen-delta2-sprite.mjs`, `capture-delta2.mjs` (checks: no console errors, no target < 24 px,
  keyboard checks OK). Screenshots (git-ignored, local): `prototype/screenshots/delta2-tiles-{dark,light}.png`,
  `delta2-option-{A,B,C}-{dark,light}.png`.
  - Option A: avatar tab strip (most clipped: `+4` at 760 px).
  - **Option B (designer recommends): agent dock** — active agent = one expanded pill (avatar, name, status word,
    duration), others = clickable avatars + an explicit `N agents ›` button; hover/focus card ("Click to view this
    thread"); shows all 8 mock agents at 760 px, degrades cleanly at 400 px.
  - Option C: split switcher (Orchestrator fixed + "Viewing: X ▾" combobox + live mini-avatars); strongest click cue,
    two steps to a non-live agent.
  - Tiles: CLI lanes via `ptah-provider-mark`; sub-agents via lucide role icons (all names verified); status ring/glyph
    with measured `--state-ink-*`; no new contrast pairs.
  - Open points for the user: Claude and Gemini are NOT CLI lane types today (`SYSTEM_CLI_TYPES` = codex, copilot,
    cursor, antigravity, opencode, pi, grok + ptah-cli); the Claude mark resolves only via provider id `claude-cli`;
    Gemini has no mark → monogram "G". Whether the hover card (option B; no touch trigger) is wanted.

## 4. Decisions to know (decisions.md rows 1-27)

Row 15 theme fallback tokens (all themes); 18 duration end E = max(assistant timestamp + duration) only; 19 inspector
open state = per-mode initial default, manual toggle per tab, mode change resets; 20 Message duration item; 21-23 user
decisions; 24 rail lane-owned question focuses the question card directly, lane title is `h2#laneTitle`; 25 a designer
ran `taskkill /F /IM node.exe` once — briefs now forbid kill-by-image-name; 27 delta 2 scope.

Architect checks already named: request `id` vs `requestId` (lane queue uses `requestId`,
`canvas-needs-you-queue.ts:57-110`); `MonitoredAgent` completion time; message `duration` / timestamps after reload;
open path for task artifacts (`editor:openFile`? must match the git sidebar); `TasksStoreService` ignores
`tasks:changed` unless the board is open (`tasks-store.service.ts:1121-1128`) → inspector needs its own consumer;
no phase field on tasks → derived Stage; bundle budget ~3.49/3.50 MB → inspector `@defer`, no tasks-ui board import.

## 5. Exact next steps

1. Read the results in §3. If codex `design-spec-review-r2.md` is APPROVED → Gate 1.7 passes for rounds 2 + delta 1
   (lane-review). If REVISE → the revise cap is spent: bring the open items to the user in ONE AskUserQuestion
   (bundle with step 2).
2. Show the user the delta-2 options (`design-delta-2-options.md` ASCII previews + `prototype/screenshots/delta2-*.png`)
   in ONE AskUserQuestion with previews (switcher option A/B/C + tile icon system). Recommend the designer's pick.
3. Fresh `ui-ux-designer` (split spec / prototype if large; context limit ~250k killed one designer): merge the chosen
   switcher + agent tiles into `design-spec.md` (new §, decisions D34+) and `prototype/index.html`; keep
   `capture.mjs checks` passing; screenshots dark + light. Then a codex delta review (`design-spec-review-delta2.md`);
   APPROVED passes Gate 1.7 (lane-review). Also PM delta: add the switcher + tiles to `task-description.md` /
   `parity-inventory.md` (canvas-lane-tabs capabilities: keyboard model, overflow, ownership filter).
4. `software-architect` → `implementation-plan.md` (resolve every architect check above) → codex review (Gate 2).
5. `team-leader` MODE 1 → `batches.md` (file-disjoint) → parallel Claude `frontend-developer` batches → team-leader
   MODE 2 per batch → codex code-logic review of the phase diff → `visual-reviewer` dark + light vs prototype
   (Electron renderer rebuild only; before/after screenshots) → commit → push + `gh pr create` (one background
   command; PR body ends with the Claude Code line).
6. Verification (per changed project, one at a time):
   ```
   node .ptah/tmp/check-run.mjs <label> -- npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs <label> -- npx nx typecheck <project> --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs <label> -- npx nx lint <project> --parallel=1 --skip-nx-cache
   node .ptah/tmp/check-run.mjs <label> -- npx nx run ptah-electron:build-dev   # then: npx nx copy-renderer-dev ptah-electron --parallel=1
   ```
   Prototype: `node .ptah/specs/TASK_2026_677_efcd/prototype/assets/capture.mjs checks` and
   `node .ptah/specs/TASK_2026_677_efcd/prototype/assets/contrast-check.mjs themes` (Playwright from
   D:\projects\ptah-extension\node_modules; NODE_PATH if needed).

## 6. Housekeeping still open

- Push `3693f9227`, `a3ab54448` (and later commits) with the PR at the end, or earlier if the user asks.
- TASK_2026_645_6aaa can start (user to open the session).
- T3-T6 follow-ups: no folders (user: leave as is).

## 7. Rules (repeat in every lane and sub-agent prompt)

Same as handoff-1.md §7, plus: never kill processes by image name (stop only own PIDs); give designers a context budget
(offset/limit reads, <= 2-3 PNG views) and split spec vs prototype work into file-disjoint agents; codex resume is
refused above 60k context → give fresh lanes complete briefs. Checks only via `node .ptah/tmp/check-run.mjs <label> --
<command>`; changed projects only, `--parallel=1 --skip-nx-cache`, Jest `--maxWorkers=2`; one heavy check at a time
(never push while a check or build runs); no workspace-wide runs; no build/serve/dev/e2e/package except the Electron
renderer rebuild; no npm install; no git in `D:\projects\ptah-final-run-ws`; UI changes need before/after screenshots
dark + light; commits foreground, explicit paths, `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, ending
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR body ends with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`; at most 3 parallel CLI lanes; handoff files are
`handoff-N.md`, never `HANDOFF.md`. Sub-agent results go to the orchestrator.
