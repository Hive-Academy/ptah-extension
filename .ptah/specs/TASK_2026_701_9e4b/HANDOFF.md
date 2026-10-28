# HANDOFF - TASK_2026_701_9e4b (session 13)

Session 13 ended 2026-10-28 (token budget, 37.6M). All task work is committed and pushed. PR #832
is still a DRAFT. The user chose "Fix dialog, then ready": the dialog fix is pushed, so the only
remaining step is to confirm CI on `762c1421d` and mark the PR ready.

## Goal

Align setup-wizard agent generation with the skills Library and enhancement flow (8 scope items,
see `context.md`): keep/replace overwrite guard (default keep), harness-root alignment, Library
refresh + provenance labels, Library edits vs. regeneration, explicit shared model setting,
prompt rubric alignment, "No grade" expectation, Marketplace plugin skills/agents in the same
flow. Electron first; visual reviews in Electron only, dark + light.

## Location

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment`
- Branch: `feat/wizard-library-alignment` (tracks origin). PR: https://github.com/Hive-Academy/ptah-extension/pull/832 (draft)
- Task folder T: `<worktree>\.ptah\specs\TASK_2026_701_9e4b`
- PR body source: `<worktree>\.ptah\tmp\pr-701-body.md` (already applied with `gh pr edit`)
- `node_modules` is a junction to the main checkout (D17). Never `npm install` there.

## Workflow state (orchestration skill, FEATURE, Full, approval mode `lane-review`)

- Gates 1, 1.7, 2 APPROVED. User decisions D3, D6-D11, D36, D37, D45 final; do not ask again.
- Team-leader MODE 3: **TASK COMPLETE with deferrals** (`T/completion-report.md`, plus its
  "Update after D51" section). `T/batches.md`: 27/27 batches COMPLETE.
- QA: team-leader recommended no extra tester pass (every phase verified + independently reviewed,
  two Electron visual reviews done). No further QA was run.

## Done in session 13 (all pushed; origin head `762c1421d`)

| Commit | Content |
| --- | --- |
| `292e775d5` | Visual fix round (issues 1, 3, 4, 6) + regression A fix (badge wraps under the name). D48, D49. Verify webview+marketplace 5/6 (only D19), marketplace 3/3, degradation audit exit 0 (276). Re-review PASS (`reviews/visual-rereview.md`) |
| `e359dec92` | P2 Electron visual review (`reviews/visual-review-p2.md`, ISSUES 0/1/5/3, warning fill 6.61:1 dark / 5.67:1 light), D50, `completion-report.md`, Batch 26 COMPLETE in `batches.md` |
| `762c1421d` | Sidebar preview dialog fix (user overturned D50 for Serious 1): native `<dialog>` + `showModal()` (top layer), viewport cap, body scrolls; Generate button no longer disabled by `previewOpen()` so focus returns on Escape/Cancel. D51. Verify setup-wizard+webview 5/6 (only D19). Electron re-check PASS (`reviews/visual-rereview-dialog.md`) |

PR body updated twice (latest includes D51 and the dialog fix). It flags the D34 contract
changes: `rpc-setup.types.ts` (changed), `rpc-setup-decisions.types.ts` (new: `FileOutcome`,
`GenerationTargetInfo`, `PackFileOutcome`), `wizard/phase.ts` (changed).

## CI

- On `e359dec92`: 19 pass, 4 skipping (Bench x2, CodeRabbit, perf), 1 fail = GitGuardian (known,
  user-side, old-commit incidents). PR MERGEABLE.
- On `762c1421d`: **PENDING at session end** (a background watcher was running). Check it first.
- No PR reviews; the last comment is the 2026-10-27 D34 thread (already answered).

## In progress

Nothing is being edited. No subagent or lane is running. Only the CI result for `762c1421d` and
"mark ready" are open.

## Open decisions / notes

- User asked (mid-session) whether this PR touches the onboarding / setup-hub revamp area. Answer
  given: yes, 57 files in `libs/frontend/setup-wizard` (P2 Batches 10-18, bundle `app.ts` entry,
  plus the D51 dialog fix), kept compatible per D34; suggested merging #832 first or having the
  onboarding branch rebase on it. No user decision is pending on this.
- D51 evidence is rendered behavior + orchestrator diff read; no separate lane code review
  (weaker-evidence label recorded in D51).
- Electron process pid 9872 (from the session-12 review, started 16:36) may still be running; the
  reviewers could not tell it apart from the user's app, so it was left alone.

## Deferred (already in the PR body and `completion-report.md`)

- Wizard UI revamp (D50, `libs/frontend/setup-wizard`): P2 findings 2, 3, 4, 7, 8, 9.
- Library badge/drawer fidelity (findings 5, 6); repair-prompt state 4c not verified (fixture gap).
- D41 (a)/(b); `external-marketplaces.component.ts` raw-error sites and split (D40); P4 finding 3,
  Minors 4-5, `enhanced-prompts.service.ts:985`; style S3-S5; P2 B3, B6-B8 (D32); visual issue 2
  (`electron-shell.component.ts:458`), issue 5, D49 Minor (non-uniform wrapped rows).

## Never commit

`T/reviews/*.patch`, `T/tmp/` (includes `T/tmp/visual/`), PNG screenshots (git-ignored, ~50 MB
under `T/reviews/visual/`), `T/reviews/visual/rereview*/`.

## Key files

- `T/decisions.md` (D1-D51), `T/batches.md`, `T/completion-report.md`, `T/context.md`
- `T/reviews/visual-review.md`, `visual-rereview.md`, `visual-review-p2.md`, `visual-rereview-dialog.md`
- `T/reports/visual-fix-report.md`, `T/reports/sidebar-dialog-fix-report.md`
- `libs/frontend/setup-wizard/src/lib/components/agent-preview-dialog.component.ts`,
  `agent-selection-list.component.ts`, `libs/frontend/setup-wizard/src/test-setup.ts`
- `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts`,
  `plugin-config-home-notice.component.ts`, `external-consent-dialog.component.ts`

## Next steps

1. Read this file. Confirm state:
   `gh pr view 832 --json headRefOid,mergeable,isDraft` (expect head `762c1421d`, MERGEABLE, draft).
2. Check CI on `762c1421d`:
   `gh pr checks 832` and `gh run list --branch feat/wizard-library-alignment --limit 8`.
   If still running, watch in the background:
   `gh pr checks 832 --watch --interval 60 > /dev/null 2>&1; gh pr checks 832 | awk -F'\t' '{print $1" | "$2}'`.
   Inspect a failure with `gh run view <id> --log-failed | grep -E "##\[error|✖|FAIL|exceeded"`.
   GitGuardian is the known user-side failure; everything else must pass.
3. If a task-related check fails: fix in the worktree, verify scoped (for setup-wizard:
   `npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview`; for marketplace:
   `npm run verify -- -p @ptah-extension/marketplace,ptah-extension-webview`; only
   `ptah-extension-webview:lint` may fail, D19), commit in the foreground with explicit paths,
   push in the background, and watch again. If the PR becomes CONFLICTING, merge origin/main
   (no rebase).
4. When CI is green except GitGuardian: mark the PR ready (the user already agreed, session 13
   answer "Fix dialog, then ready"): `gh pr ready 832`. Report the PR URL, head, CI and review state.
5. Keep watching for review comments (`gh pr view 832 --json reviews,comments`) and address
   actionable ones. Do not merge, force push, rewrite history, delete the branch, or remove the
   worktree without the user's authorization.

## Rules for every lane and subagent

Scoped `npm run verify -- -p ...` only, one run, output filtered, long runs in background with
timeout 3600000; never workspace-wide; never build/serve/dev/e2e/package (except the isolated
Electron launch for visual review, D45, under `node scripts/verify.mjs --exec --task <name> -- ...`);
Electron first; keep every host compiling; executors never commit/push or edit
batches.md/task.md/decisions.md/HANDOFF.md; never git stash/restore/checkout/reset/clean; never
`npm install` in the worktree. Commit in the foreground with explicit paths and
`.commitlintrc.json` scopes (`marketplace`, `setup-wizard`, `webview-e2e-harness`,
`agent-generation`, `agent-sdk`, `rpc-handlers`, `task-specs`; `plugin-marketplace` is not a scope).
Push in the background. Do not commit while a subagent edits files. Lanes: codex Weekly 98%
(resets 2026-11-02) - avoid; opencode at limit (resets 2026-11-04); Glm
(`pc-355b645d-35af-4974-84cf-9cf961ea0164`, `modelTier: opus`) for reviews. No merge to main,
force push, history rewrite or worktree removal. The user's wizard UI revamp owns
`libs/frontend/setup-wizard`: no further UI work there beyond CI fixes (D34, D50).
