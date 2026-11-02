# HANDOFF — TASK_2026_858_c7a2: staggered enter/leave for chat transcript messages

## Goal

Motion plan item 4 (items 1-3 merged in PR #880, 0f0f2a8ca). Electron first. When several messages
appear together they enter one after another with a capped stagger (max 6 rows, 36 ms step,
180 ms max delay); leaving messages animate out with no layout jump; streaming chunks never
re-animate; follows the active motion preset; glass = transform-only enter + cut leave; reduced
motion / Electron "Reduce motion" turn it off; older-history prepend and off-window rows never
animate. User-facing text in ASD-STE100 Simplified Technical English.

User decisions so far:
- Gate 2 (implementation-plan.md) APPROVED by the user.
- Visual defect D2 decision: **"Always stagger on open"** — every session open / history load
  staggers the rows; on a tab edge the incoming pane-switch motion becomes a plain opacity
  crossfade (no transform) so the motions do not stack; switch to an already-loaded tab = crossfade
  only.

Workflow rules from the user: codex lanes implement, Claude subagents review (reviewer family must
differ from implementer), max 3 lanes at a time, max 2 revise rounds (fix round 1 in progress, one
left). Verify only `npm run verify -- -p <changed projects>`. Build Electron only with
`node scripts/verify.mjs --exec --task <name> -- npx nx build ptah-electron` then
`node apps/ptah-electron/scripts/copy-renderer.js`. No serve/e2e/workspace-wide. Visual test via a
visual-reviewer subagent with Playwright `_electron` and `--force-prefers-no-reduced-motion`
(except Reduce-motion runs), one Electron instance at a time; dark, glass, light, all presets.
Only the coordinator commits (foreground) and pushes (background); `.commitlintrc.json` (subject
<= 72, body lines <= 100). One PR to main, watch CI, address review. No force push/merge/branch or
worktree deletion.

## Done (nothing committed yet)

- Worktree `D:\projects\ptah-extension\.claude-worktrees\chat-message-stagger`, branch
  `feat/chat-message-stagger`, base 0f0f2a8ca. node_modules is a junction to the main checkout
  (never npm install; remove with `cmd /c rmdir` before any worktree removal).
- Plan: `implementation-plan.md` (architect subagent) + `implementation-plan-review.md`
  (Claude reviewer, APPROVED after 2 rounds). Same-side review because kimi code (429) and
  antigravity (quota, ~104 h) were at limit.
- B1 (codex): `transcript-entrance.ts` (pure `planEntrance`, `ENTRANCE_CAP=6`, shared
  `isStrictHeadPrepend`), new `transcript-motion.directive.ts` (+spec), anchor directive import.
  Verify `-p @ptah-extension/chat` passed 3/3.
- B2 (codex): `.chat-msg-item` wrapper, class-based `animate.enter`/`animate.leave`, CSS,
  `paneSwitching` input in chat-view, `styles.css` (removed `.message-enter`, vt-active rule, glass
  scrim selectors), specs. Verify `-p @ptah-extension/chat,ptah-extension-webview` EXIT 0.
- B3 (codex): `apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts` reads through
  `.chat-msg-item` and skips `[data-ptah-leaving]`. Typecheck `-p ptah-electron-e2e,@ptah-extension/webview-e2e-harness` 2/2.
- Code-logic review (Claude vs codex, B1+B2): `code-logic-review.md` APPROVED 7/10, 0 Blocking /
  0 Serious, 4 Moderate (not fixed under one-fix-round rule → list as later work in the PR), 4 Minor.
- Electron build + renderer copy done once (before fix round 1; must be rebuilt).
- Visual review 1: `visual-review.md` + `visual-review/` — **FAIL**: D1 first reply enters twice
  (finalized row gets a new slot id, replaces streaming row in one pass); D2 stagger never shows
  (every load is a tab edge → suppressed). Chrome 152, `interpolate-size` supported. Presets,
  leave inert/aria-hidden, prepend passed. Note: the reviewer ran from a copy of the bundle
  because the app refuses sessions of `D:\projects\ptah-extension` when the app folder is inside it.

## In progress / Background work

- **Codex lane `25bf4a8f-5a99-4a82-852d-1aed759e229a`** (CLI Session ID
  `01a19940-634f-7050-afbb-32c1a651d3b3`), state `running` since 2026-11-01T22:34Z: fix round 1
  for D1 (swap → no enter + cut leave, or stable id) and D2 (user decision above). Deliverable
  `fix-R1-report.md` in this folder. Scope: transcript folder, chat-view.*, maybe
  stream-presentation-store.service.ts. Its completion signal goes to the new session.

## Open problems

- `task-tracking/landing-live-demo/HANDOFF.md` is modified in this worktree by ANOTHER writer
  (mtime before this task). Never stage or revert it.
- Branch is 58 commits behind origin/main: merge main before the PR (`git merge origin/main`, no
  rebase/force push), then re-verify.
- Visual review "Not tested": 200+ message session (max 55 found), rewind+send within 230 ms, rows
  above viewport during leave, glass blur flicker.

## Key files

- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.ts` — planner.
- `.../transcript/transcript-motion.directive.ts` — id diff, enter map, leave marks.
- `.../transcript/chat-transcript.component.{html,css,ts}` — wrapper, bindings, motion CSS.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` — tab-edge pane switch.
- `apps/ptah-extension-webview/src/styles.css` — global motion, vt-active, glass scrim.
- This folder: `context.md` (lane/limit log, decisions), plan, reviews, batch reports.

## Next steps

1. On the lane's `<agent-lane-completed>`: read `fix-R1-report.md`, read the diff, run
   `npm run verify -- -p @ptah-extension/chat` (and `,ptah-extension-webview` if styles.css changed).
2. Rebuild: `node scripts/verify.mjs --exec --task stagger-electron-build -- npx nx build ptah-electron`
   then `node apps/ptah-electron/scripts/copy-renderer.js`.
3. Short visual re-check (visual-reviewer subagent, same method as `visual-review.md`; profile
   `%TEMP%\ptah-stagger-udd`): D1 reply enters once; D2 session open / history load staggers with
   delays 0..180 ms and the pane is opacity-only; loaded-tab switch = crossfade only; glass, light,
   Reduce motion. Write `visual-review-round-2.md`.
4. Short code-logic re-check of the fix diff (Claude subagent, family differs from codex).
   If defects remain after this second round: one bounded correction or report them; do not reset the cap.
5. Merge origin/main, re-verify the changed projects, then commit in the foreground (stage explicit
   paths only; exclude HANDOFF.md of landing-live-demo), e.g. `feat(chat): stagger transcript
   message enter and leave` — check scopes in `.commitlintrc.json`.
6. Push + `gh pr create` in the background (title < 70 chars, `## Summary`, `## Test plan` with
   real results, Moderate findings as later work, end with the Claude Code attribution line).
   Watch CI and reviews; fix confirmed findings with new commits.
