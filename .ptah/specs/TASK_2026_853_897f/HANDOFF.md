# HANDOFF — TASK_2026_853_897f (session prefix diet), Phase D

Written 2026-11-01 ~03:35 local. Supersedes every earlier HANDOFF.md copy.

## STATUS (2026-11-01, latest — read this first)
- Fix round done and committed: `557eff874` backend (L1-L6, S3, V4, V5, round-2 defects 1-3),
  `0ffce5523` frontend (V1-V3, minors 9/11, coded failure display). Decisions #81-#83.
- Reviews: codex round 2 REVISE 6/10 -> one bounded fix -> round 3 REVISE 8/10 with one
  disputed item (#83, no change); revise cap exhausted. Visual round 2 PASS
  (`visual-review-phase-d-round2.md`, `evidence/pd-r2-*.png`).
- Full D verify `/tmp/tpd-d-fix-verify.log`: only the known environmental
  `agent-workspace-scope.spec.ts` failure.
- Next: push + PR to main, watch CI. MCP registry 404 = separate session (prompt given to user).

## Goal
Cut Ptah's fixed session prefix in four phases, each its own PR (implementation-plan.md:3-5):
**A** built-ins default-off, **B** hide claude.ai-synced skills, **C** remove duplicate prompt
text, **D** workspace scope as install default (Batches 17–35, 41, 36–40, then F-D4 AFTER
screenshots). Specs in this folder: `batches.md`, `implementation-plan.md`, `decisions.md`
(#1–#73), `reports/batch-N.json`.

User decisions: claude backend/frontend-developer subagents implement, codex reviews (#52);
skip kimi. Phase D gets ONE independent codex code-logic + style review over the combined D
diff, plus Electron visual review after Batch 40, before the initial push.

## Done
- Phase A #854, B #862, C #863, CLI-lane PR #865: merged.
- Phase D: worktree `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d`,
  branch `feat/session-prefix-diet-d`, NOT pushed, PR will target `main`. Head `64bd4d445`.
  Earlier commits: B17–B30, B32 (see git log). This session:
  - `f7283a905` B31 feat(vscode-lm-tools): document workspace default in harness help
  - `4510058a8` B33 feat(rpc-handlers,agent-generation): migrate legacy installs to workspace
    - 31+33 cohort verify: 71/71 ok; degradation audit exit 0.
  - `8fd439795` B34 feat(rpc-handlers): add install migration notice RPC and fixtures
    - V-RPC: 68 tasks, 67 ok, only known webview lint; audit exit 0.
  - `c2b62f5db` B35 feat(shared,rpc-handlers,electron): start install migration on boot
  - `64bd4d445` B41 test(vscode): cover install migration services in container smoke
    - 35+41 cohort (shared, rpc-handlers, all hosts, webview): 71 tasks, 70 ok, only known
      webview lint; audit exit 0; di-lint OK.
- F-D4 BEFORE screenshots RECAPTURED (originals lost: `.ptah/specs/**/*.png` is git-ignored and
  the Phase A worktree was removed): `evidence/f-d4-before-dark.png`, `evidence/f-d4-before-light.png`,
  report `reports/a0-electron-before-recapture.md` (uncommitted). Coordinator viewed the dark
  image: old copy "Ptah will NOT register or run these servers" — correct BEFORE state. These
  PNGs exist only in this worktree; never remove it before AFTER evidence is taken.

## UPDATE (later session, 2026-11-01)
- `0ed598683` B36 feat(chat-ui,marketplace) (+ decisions #72-#75, recapture report).
- `9bf67c95e` B40 feat(chat) notice card (ran in parallel with 36, decision #74; focus rule #75).
- 36+40 cohort: `/tmp/tpd-b36-40-verify.log` 21 tasks, fails = known webview lint + chat:test
  that did not reproduce (rerun `/tmp/tpd-chat-test.log` 311/311 suites); audit exit 0.
- `088341e3b` B37, `b2ebf0953` B38, `c967b14c7` B39 (cohort `/tmp/tpd-b37-39-verify.log`: only
  known webview lint; audit exit 0; decision #76 = B37 placement + file sizes).
- origin/main merged (clean merge commit on top of c967b14c7). Running now:
  - post-merge verify of all 15 D projects -> `/tmp/tpd-d-postmerge-verify.log`
  - codex review lane (code-logic + style) -> `code-logic-review-phase-d.md`, `code-style-review-phase-d.md`
  - visual-reviewer subagent (fresh Electron build under lock) -> `visual-review-phase-d.md`,
    `evidence/f-d4-after-{dark,light}.png`
  Codex review DONE: logic REVISE 3/10 (6 findings), style APPROVED WITH NITS 7/10; codex CLI
  Session ID 01a1950c-69cc-7490-b2c8-9cf1723cf4de (resume it for the re-review of the fix diff).
  Post-merge verify was STOPPED before fixes (decision #77). Fix lanes A (L1, L4, S3) and B (L2,
  L3, L5, L6) running as backend-developer subagents. Then: full D verify, codex re-review
  (resume), commit fixes.
  Visual review DONE: REVISE (visual-review-phase-d.md; F-D4 AFTER pair PASSES, in evidence/).
  Fix round state (all uncommitted, decisions #77-#80): Fix B done (L2,L3,L5,L6 + resolver
  fail-safe), Fix C done (V1,V2,V3, minor 9/11), Fix A done (L1,L4,S3) and now continuing with
  V4, V5 and the listRetired-throws check (/tmp/tpd-fixA2.log). After it: full D verify (15
  projects, list in this file's post-merge command), codex re-review via resume, Electron
  re-capture of notice card + consent focus + installed rows, then commit fixes per lane.
  Pre-existing, outside D: live MCP registry 404 / new schema -> report to user, own task.
  Next (old): fix confirmed findings (frontend/backend-developer subagents, 1 bounded round), re-verify,
  push in background + `gh pr create` to main (release note: VS Code/CLI keep legacy behaviour
  until Electron ran the migration once), watch CI. The section after this is OLD.

## (OLD) In progress — Batch 36 (uncommitted, subagent stopped with the previous process)
Frontend-developer subagent was implementing F-D1 and stopped mid-run. Files in the D worktree:
- NEW `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/install-scope-field.component.ts` + `.spec.ts`
- MOD `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts` + `.spec.ts`
- MOD `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts` + `.spec.ts`
- MOD `libs/frontend/chat-ui/src/index.ts` (+9 lines; decision #73 allows ONE export statement
  for the field component and its public types — check it is only that)
State: scoped specs `/tmp/tpd-b36-scoped.log` = 2 tasks ok (Jest counts not read). Typecheck/lint
run `/tmp/tpd-b36-tc.log` ended exit 130 (interrupted) with `✖ @ptah-extension/chat-ui:typecheck`
— real failure or interruption artefact is UNKNOWN. No batch-36.json report yet. Completeness vs
acceptance (batches.md:549-558) is unverified; the store must expose the full API for 37–39.

Also uncommitted: `decisions.md` rows #72, #73; `reports/a0-electron-before-recapture.md`.

## Open problems and decisions
- Known non-batch failures (ignore): `ptah-extension-webview:lint` (pre-existing); 2 tests in
  harness-sync `agent-workspace-scope.spec.ts` (environmental; never touch `/home/amun/projects/.ptah`);
  ptah-electron git-watcher and vscode-lm-tools outliner timing tests under load.
- For the Phase D review (recorded in reports/batch-35.json `findings`):
  `registerRpcSurface` resolves every manifest handler at activation without a try (VS Code
  `bootstrap.ts:177`, CLI `cli-engine/src/lib/container.ts:982`), so the VS Code container smoke is
  the only construction gate; `SkillsShSourceRootService` has the same latent defaulted-param /
  decorator-metadata issue (#70/#71), unchanged; CLI `EXPECTED_RESOLVABLE` lacks the two new classes.
- Batch 33 service ~795 non-comment lines → `max-lines` lint warning only.
- Release note for the PR: VS Code and the CLI keep legacy behaviour (notice null) until Electron
  ran the migration once (D-D5, #23).
- Worktrees `session-prefix-diet-cifix` and merged B/C/cli-lane worktrees: remove only with user
  authorization.

## Key files
- `.../TASK_2026_853_897f/batches.md` — scope/acceptance; contract lines 52-86; Batches 36–40 at 549-607 (paths say `session-prefix-diet/`; use `-d`).
- `.../TASK_2026_853_897f/decisions.md` — #56-#73 are the Phase D contracts and this session's rulings.
- `.../reports/batch-33.json`, `batch-34.json`, `batch-35.json`, `batch-41.json` — migration API, notice RPC, registration, boot trace.
- `.../reports/a0-electron-before.md` + `a0-electron-before-recapture.md` — exact isolated Electron capture method (reuse for AFTER).
- `.../design-spec.md`, `prototype/index.html` — UI spec for 36–40.

## Background work
None alive. The Batch 36 frontend-developer subagent ended with the previous process (its
partial edits are on disk, listed above). No CLI lanes or child sessions.

## Next steps
1. Finish Batch 36: start a frontend-developer subagent with the same brief (batches.md Batch 36,
   decision #73, files above) told to CONTINUE the existing edits, not restart. It runs only:
   `npm run verify -- -t test -p @ptah-extension/chat-ui,@ptah-extension/marketplace -- --testPathPatterns='install-scope-field|mcp-directory-browser|marketplace-inventory' > /tmp/tpd-b36-scoped.log 2>&1`
   and `npm run verify -- -t typecheck,lint -p @ptah-extension/chat-ui,@ptah-extension/marketplace > /tmp/tpd-b36-tc.log 2>&1`.
   It must report the store/component API handoff for 37–40.
2. Coordinator: inspect the diff, then V-UI-INTEGRATION:
   `npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/marketplace,ptah-electron,ptah-extension-webview > /tmp/tpd-b36-verify.log 2>&1`
   (filter `grep -E "NX .*tasks|✖"`), then
   `node scripts/verify.mjs --exec --task degradation-audit -- npx nx run degradation-audit:lint --skip-nx-cache --output-style=static`.
   Write reports/batch-36.json; commit B36 (scope `webview`? — check `.commitlintrc.json`
   scope-enum for chat-ui/marketplace) with decisions #72/#73 and the recapture report.
3. Batches 37, 38, 39 in parallel (file-disjoint; never edit the store or index.ts), scoped specs
   each, then one V-UI-INTEGRATION cohort (39 = V-MARKET), commit each separately. BEFORE images exist.
4. Batch 40 (notice card; uses `harness:get-install-migration-notice` / `harness:dismiss-install-migration-notice`).
5. Codex Phase D review (code-logic + style) over `git diff main...HEAD`; Electron visual review
   dark/light; F-D4 AFTER screenshots (`evidence/f-d4-after-{dark,light}.png`) using the
   recapture method but a fresh Electron build of the D worktree (build allowed only for the
   screenshot launch). Then push in background, open PR to main (state release note above),
   watch CI and reviews.

## Rules (repeat to every subagent and lane)
- Worktrees only. Verify only with `npm run verify -- -p <changed + dependent hosts>`; never
  workspace-wide or nx run-many; save output to a file and filter it; Jest flags only on `-t test`.
- Never verify while another batch's edits are unfinished (decisions #60/#62). Parallel batches
  run scoped specs only; coordinator runs one cohort verify, then commits each batch separately.
- Other heavy commands: `node scripts/verify.mjs --exec --task <name> -- <cmd>`.
- No build/serve/e2e except Electron screenshot launches. Electron first; keep all hosts compiling.
- Never raise a tool-description size budget.
- Never stage node_modules links or `.ptah/specs/TASK_2026_854_8f0d/`.
- No DB deletion, settings/account changes or credential use without asking. Do not touch `/home/amun/projects/.ptah`.
- Never merge, force-push, or remove worktrees. Commit each batch in the foreground; push in the background. Append decisions to decisions.md (next is #74).
