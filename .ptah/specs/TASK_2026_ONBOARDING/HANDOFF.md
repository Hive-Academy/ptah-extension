# HANDOFF — TASK_2026_ONBOARDING

## Goal

Replace the chat-streaming setup-wizard / setup-hub / harness-builder flows with a first-run
**Onboarding module** (`libs/frontend/onboarding`). It has 3 cards (New project, Analyze current
project, AI team builder), dedicated step UIs, a localStorage flag `ptah.onboarding.v1` and a route
guard. Electron first; VS Code and the TUI must keep compiling. No backend changes. All user decisions
are in `context.md`; do not re-ask them.

## State (2026-10-27)

- Worktree `/home/amun/ptah-extension/.claude-worktrees/onboarding-module`, branch
  `feat/onboarding-module` (from main 0e17912e3). **No source code yet. No commits yet.**
  The task folder `.ptah/specs/TASK_2026_ONBOARDING/` is staged (`git add`) but NOT committed:
  `git commit` failed with "Author identity unknown" (this machine has no git user.name/email and no
  GIT_AUTHOR_* env). Do not change git config yourself. The user has been asked to either configure
  it, or authorize a one-off `git -c user.name="Abdallah khalil" -c user.email="abdallah.khalil.nada@gmail.com" commit ...`.
  Note: recent main commits carry an odd author `Test <test@test.com>`; the user was told to check
  this. Do not copy that identity.
  The staged commit message prepared for it: `docs(setup-wizard): plan the onboarding module (TASK_2026_ONBOARDING)`.
- A local read-only ref `refs/remotes/pr/832` (PR 832 head 65499f2c) was fetched in this worktree.
- **Design**: approved by the user (`design-spec.md`, `prototype/`).
- **Plan**: `implementation-plan.md`. Codex review r0 REVISE → r1 REVISE → r2 APPROVED (reviews in
  `implementation-plan-review.r0/r1/r2.md`). **User approved it at Gate 2.**
  - D9 (user): guidance stays bound; section word counts come from `getPromptContent`, bracketed by
    run-ID-less `getRunState` lookups. The token total, the fallback badge and the Quality Guidance
    row are dropped. R12 (an out-of-process writer such as ptah-cli) is a documented residual.
- **PR 832 addendum**: `parity-inventory.pr832.md` and `implementation-plan.addendum-pr832.md`.
  Codex APPROVED (`implementation-plan.addendum-pr832-review.md`).
  - PR-R1 (user): "Generate without preview" is removed; A2 offers Retry only.
  - Deletions go from 51 to 53; batches B2, B3a, B3b and B5b change; the order B1..B5b is unchanged.

## Blocker: waiting on PR #832

Draft PR #832 (`feat/wizard-library-alignment`, another machine; head 65499f2c when the addendum
was written) heavily changes `libs/frontend/setup-wizard`. The user decided implementation starts
**after #832 merges**.

### #832 delta check (2026-10-27, head f2a31263, still OPEN draft)

Two new commits after 65499f2c: `2186bdeb1` (vscode content manifest only) and `f2a312631`
(`@defer` for the preview dialog, preview-decisions, pack-install prompt and completion views to
fix the webview 4 MB budget; `OutcomeFileRow` + `libraryReachable` moved from
`outcome-summary.component.ts` to a new `completion/outcome-rows.ts`). The PR touched no
rpc-setup*.ts and no phase.ts. Effect on the addendum: only citations shift (`outcome-summary…:24-48`
→ `outcome-rows.ts`, `agent-next-steps`, `completion`, `agent-selection*`, `community-packs-panel`
lines). No decision changes. At the rebase, add the new file to the B5b reuse list (addendum l.257).
Also check that the onboarding route does not undo the budget fix by eagerly importing the
now-deferred views. Ref: `refs/remotes/pr/832-new`.

Head 720c039a (checked against the diff from f2a31263, after the #832 session replied on the PR,
comment 2026-10-27T19:20Z): `79ae1f6dc` changes the backend plugin and skills-sh RPC handlers and
`rpc.types.ts` (+39 lines). Re-check the plan's `rpc.types.ts:1253-1256` citation at the rebase.
`9e25520c2` puts `@defer` into `wizard-view.component.ts` and
`generation-agent-sidebar.component.ts`. The plan deletes both (deletion rows 1 and 18-19), so this
is moot. `720c039a7` changes spec fixtures only. No change reaches `rpc-setup*`, `phase.ts`, the
reused completion files or the barrel. #832 still has batches 21-26: no setup-wizard changes, and
it will flag it if batch 26 touches `wizard-generation-rpc.handlers.ts`.

## Background work

None. All lanes and subagents have finished. Their results are in the task folder: codex reviews
73e39fcf…, 3d91a492…, 1e5f463a… and 01976ddd…; the architect subagents' revisions are applied.

## Next steps

0. Commit the staged planning docs once the user resolves the git identity (see State). Run the
   commit in the foreground from the worktree, with the message above plus the line
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push yet.
1. Check #832: `gh pr view 832 --json state,headRefOid`. If it changed setup-wizard, the
   rpc-setup*.ts files or phase.ts after 65499f2c, diff those against the addendum's citations.
2. Once it merges: `git fetch origin main` and rebase `feat/onboarding-module` onto main (no force
   push is needed while the branch is unpublished). Work through the addendum's `## Rebase notes`;
   the line numbers will shift. If the delta changes anything that matters, revise the addendum and
   have codex re-review it.
3. Implement B1 → B5b strictly in series, one frontend-developer subagent at a time, in this worktree.
   - Each batch: follow the base plan's batch section plus the addendum's delta for that batch.
   - Verify only with the per-batch commands in the plan's Verification matrix
     (`npm run verify -- -p …` and `npm run verify -- -t lint,typecheck -p …`).
   - UI batches: dark and light Electron screenshots compared with `prototype/index.html`.
4. Code review by a family other than the implementer's (codex if the implementer is claude),
   written to `code-logic-review.md`.
5. Commit in the foreground. The scopes come from `.commitlintrc.json`, which has no `onboarding`
   scope yet: either add one, or use existing scopes such as `webview` and `setup-wizard`. Push in
   the background, `gh pr create` against main, then watch CI.

## Key files (task folder `.ptah/specs/TASK_2026_ONBOARDING/`)

`context.md` (decisions + lane log), `design-spec.md`, `prototype/`, `implementation-plan.md`,
`implementation-plan.addendum-pr832.md`, `parity-inventory.md`, `parity-inventory.pr832.md`,
`backend-contract.md`.
