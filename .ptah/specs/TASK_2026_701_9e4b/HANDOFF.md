# HANDOFF - TASK_2026_701_9e4b (session 11)

Session 11 ended 2026-10-28 (token budget, 43M). Draft PR #832 is open. Origin head is
`30818d87e`. The P3 fix round is DONE BUT UNCOMMITTED in the worktree (see "In progress").

## Goal

Align setup-wizard agent generation with the skills Library and enhancement flow (8 scope items,
see `context.md`): keep/replace overwrite guard (default keep), harness-root alignment, Library
refresh + provenance labels, Library edits vs. regeneration, explicit shared model setting,
prompt rubric alignment, "No grade" expectation, Marketplace plugin skills/agents in the same
flow. Electron first; visual reviews in Electron only, dark + light.

The user revamps the setup-wizard UI separately. Do NOT add setup-wizard UI work beyond CI fixes.
Obey D34 (onboarding-session constraint, see decisions.md).

## Location

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment`
- Branch: `feat/wizard-library-alignment` (tracks origin). PR: https://github.com/Hive-Academy/ptah-extension/pull/832 (draft)
- Task folder T: `<worktree>\.ptah\specs\TASK_2026_701_9e4b`
- `node_modules` is a junction to the main checkout (D17). Never `npm install` there.

## Workflow state (orchestration skill, FEATURE, Full, approval mode `lane-review`)

Gates 1, 1.7, 2: APPROVED. User decisions D3, D6-D11, D36, D37 final; do not ask again.
Executors: Claude subagents. Reviewers: CLI lanes (`ptah_agent_spawn`: omit `taskKind`/
`routingSource`; codex cannot run git, give it patch files).
Lane limits at session end: codex Weekly 93% (resets 2026-11-02 08:07 UTC) - use it sparingly;
opencode AT LIMIT (monthly, resets 2026-11-04); Glm (ptah-cli `pc-355b645d-35af-4974-84cf-9cf961ea0164`,
Ollama Cloud, a non-Claude family) worked well for the style review.

Accepted pre-existing failures: `ptah-extension-webview:lint` (D19, circular dep
`app.routes.ts:224`), `@ptah-extension/agent-sdk:lint` (D21), `@ptah-extension/core:lint` (D35),
audit flag `apps/ptah-electron/src/ipc/ipc-bridge.ts:324`. GitGuardian incidents 39165257 /
39165258 on old commits: the user must mark them false positive in the dashboard.

## Done in session 11

| Item | Result |
| --- | --- |
| CI on `82cb4b699` | `checks` and `webview-e2e` PASS; webview initial total 3.87 MB < 4.00 MB (D38). Budget unchanged |
| `c9ffaae68` Batch 24 | consent local-files section, install counters, `KeptItemsRepairPromptComponent`; verify 5/6, only D19 lint. Pushed |
| `30818d87e` Batch 25 | installed view provenance/contents/shadow, multi-word search, `PluginConfigHomeNoticeComponent`; verify 5/6, only D19 lint. Pushed |
| Keep-alive | `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`: 55/55 PASS (on 30818d87e; the fix round started during the run, so run it again) |
| P3 code-logic review | codex, REVISE 5/10, `T/reviews/p3-code-logic-review.md` (L1 Blocking, L2 Blocking, L3 Serious; all spot-checked, confirmed). codex session `01a17f50-afc3-7d02-86da-200f99e20969` |
| P3 style review | Glm, REVISE 7/10, `T/reviews/p3-code-style-review.md` (S1 Serious, S2/S3 Moderate, S4/S5 Minor). Glm session `4dfe0eea-f37e-4e90-97a9-b27340eda2be` |
| Decisions | D38-D42 added in decisions.md (D39 repair prompt only for no-dialog families; D40 raw errors; D41 open gaps; D42 fix-round scope) |
| Batches 24, 25 | marked COMPLETE in `T/batches.md` |

## In progress - P3 fix round (uncommitted, subagents finished)

Reports: `T/reports/p3-fix-backend-report.md`, `T/reports/p3-fix-frontend-report.md`.

- Backend (L1, S1, S2): new `libs/backend/rpc-handlers/src/lib/handlers/marketplace/plugin-local-items.service.ts`
  (+ spec) holds the local-item helpers; `plugin-rpc.handlers.ts` 1514 -> 1294 lines; external
  confirm runs a final awaited Library pass after replacements and reports it; one kind->reason map.
  Also changed: `marketplace-local-items.service.ts`, `plugin-rpc.handlers.spec.ts`,
  `register-shared-rpc-handlers.ts`. Subagent verify: first run failed `rpc-handlers:test` (ESM in
  new spec), fixed; re-run of rpc-handlers lint+test 2/2 PASS. NOT yet verified by the orchestrator.
  CHECK: whether the new DI service needs the host DI guard specs (`container.smoke.spec.ts`,
  `expected-resolvable.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`) updated.
- Frontend (L2, L3, D41c): `marketplace-inventory.store.ts` listens to `LibraryChangeFeed`, reloads
  requested slices, `libraryPassFailed` root-scoped; new child
  `pages/skills/installed-library-stale-notice.component.ts` (NO spec file - add one or confirm it is
  covered by the page spec); config-home notice passes `libraryPass: 'failed'`; consent dialog and
  repair prompt show fixed copy (sentinel-path specs). Subagent verify 5/6, only D19 lint.
  Subagent choices to confirm: notice text "The Library may be out of date until its next refresh."
  with `role="status"`; repair prompt keeps host text for replies with an `errorCode`.
- Deferred (record in PR body as later tasks): style S3 (two Zod idioms), S4, S5; D41 (a) kept-file
  notes need a backend read RPC, (b) turned-off-copy footer; six older raw-error sites in
  `external-marketplaces.component.ts` (load/add/remove/browse/plan/uninstall, pre-date this task);
  `external-marketplaces.component.ts` split (D40).

## Uncommitted / never commit

- Commit with the fix round: the code files above, `T/decisions.md`, `T/HANDOFF.md`,
  `T/reports/p3-fix-*.md`, `T/reviews/p3-code-logic-review.md`, `T/reviews/p3-code-style-review.md`.
- Never commit: `T/reviews/*.patch`, `T/tmp/`.

## Next steps

1. Read this file, then `T/decisions.md` D34-D42, then both `T/reports/p3-fix-*.md`.
2. Verify the fix round yourself (one run, background, timeout 3600000):
   `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/marketplace,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-extension-webview > /tmp/p3fix.log 2>&1; echo "exit $?"; sed 's/\x1b\[[0-9;]*m//g' /tmp/p3fix.log | grep -E "Running target|tasks:|✖|error TS|FAIL" | head -30`
   Only `ptah-extension-webview:lint` (D19) may fail. Then the keep-alive:
   `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`
3. Make a fix patch (`git diff > T/reviews/p3-fix-diff.patch` plus the untracked new files, e.g.
   `git add -N <new files>` first, or `git diff --no-index /dev/null <file>`). Resume the codex
   reviewer (`resume_session_id 01a17f50-afc3-7d02-86da-200f99e20969`, cli codex) for ONE short
   re-review of L1-L3 + D41c, deliverable `reviews/p3-fix-rereview.md`. If codex is at its limit,
   use Glm (resume `4dfe0eea-...` for S1/S2) and record the reason. Record the verdict in decisions.md.
4. Commit in the foreground with explicit paths (scopes from `.commitlintrc.json`, e.g.
   `fix(rpc-handlers,marketplace): ...`), then push in the background. Watch `gh pr checks 832`.
5. Batch 26 (generation prompt rubric, `libs/backend/agent-generation`, `T/batches.md` "Batch 26")
   with a backend-developer subagent, its verify, a codex (or other non-Claude) logic review. If it
   touches `wizard-generation-rpc.handlers.ts`, flag it in the PR body (D34).
6. Electron visual review (D31, D15; dark, light, ~400 px): F6 pointer, F7i states, provenance
   badge, consent local-files section, repair prompt, config-home notice, Library stale notice,
   setup-wizard steps after the @defer/entry change. The user must start Electron.
7. Team-leader MODE 3. Update the PR body (`gh pr edit 832 --body-file <worktree>\.ptah\tmp\pr-701-body.md`):
   Batches 20-26, the bundle fix and the `@ptah-extension/setup-wizard/app` entry (D34 mention),
   D39-D42, deferred items, actual verify results. Mark ready only when the user agrees.

## Rules for every lane and subagent

Scoped `npm run verify -- -p ...` only, one run, output filtered, long runs in background with
timeout 3600000; never workspace-wide; never build/serve/dev/e2e/package (except a build the user
approves); Electron first; keep every host compiling; executors never commit/push or edit
batches.md/task.md/decisions.md/HANDOFF.md; never git stash/restore/checkout/reset/clean; never
`npm install` in the worktree. Commit in the foreground with explicit paths and
`.commitlintrc.json` scopes (`plugin-marketplace` is not a scope); push in the background. Do not
commit while a subagent edits files (lint-staged). No merge to main, force push, history rewrite or
worktree removal.
