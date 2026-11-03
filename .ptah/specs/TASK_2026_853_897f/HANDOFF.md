# HANDOFF — TASK_2026_853_897f (session prefix diet), Phase D

Written 2026-11-01 (evening). Supersedes every earlier HANDOFF.md copy.

## Goal
Cut Ptah's fixed session prefix in four phases, each its own PR. A, B, C and the CLI-lane PR are
merged (#854, #862, #863, #865). **Phase D** = new skill and MCP installs default to the current
workspace (install scope field, per-scope MCP intent, Make global, one-time boot migration of
legacy global installs, chat notice card). Specs in this folder: `batches.md`,
`implementation-plan.md`, `decisions.md` (#1-#85), `reports/`.

User decisions: claude subagents implement, codex reviews (#52); skip kimi. Latest instruction:
**rely on CI for verification** for this PR (no local `npm run verify` before pushes).

## Done (all checked)
- Worktree `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d`, branch
  `feat/session-prefix-diet-d`, pushed.
- **PR #879** https://github.com/Hive-Academy/ptah-extension/pull/879 against `main`.
  Head `711641e34`: CI 20 pass, 3 skipped, 0 fail. Merge state `BLOCKED` / `REVIEW_REQUIRED`
  (needs a human approval; never merge).
- Commits after Batches 17-41:
  - `557eff874` fix(shared,harness-sync,cli-agent-runtime,rpc-handlers,cli): close review gaps
  - `0ffce5523` fix(chat,chat-ui,marketplace): fix install scope review findings
  - `32d49c399` docs(docs): record Phase D review rounds and fix outcomes
  - `d990147cc` fix(harness-sync,rpc-handlers,vscode-lm-tools): address PR review (CodeRabbit x4)
  - `6a0fe2eeb` test(electron): expect the scoped MCP consent copy in e2e
  - `4e1d36f44` fix(rpc-handlers): keep migration state safe on partial failures (#85)
  - `711641e34` fix(rpc-handlers): attach the audit marker to the registry read catch
- Reviews: codex logic rounds 1-3 (`code-logic-review-phase-d*.md`); codex on the CodeRabbit fixes
  (`code-logic-review-pr879-coderabbit.md`, REVISE -> fixed in `4e1d36f44`); final
  (`code-logic-review-pr879-migration.md`: no new Major+, only the partial-3 race, accepted #85).
  Electron visual round 2 PASS (`visual-review-phase-d-round2.md`, `evidence/pd-r2-*.png`; PNGs
  are git-ignored, exist only in this worktree). CodeRabbit verified and resolved all 4 threads.
- Local full D verify before the PR (`/tmp/tpd-d-fix-verify.log`): only the known environmental
  harness-sync `agent-workspace-scope.spec.ts` failure (real `/home/amun/projects/.ptah`).
- First-run electron-e2e shard-2 `hunk-revert-top-layer.spec.ts` failure was a flake (passed on
  rerun; main fails daily on unrelated `review-canvas-large.spec.ts`).

## In progress
Nothing. This HANDOFF.md rewrite is the only uncommitted change.

## Open problems and decisions (waiting on the user)
1. Approve/merge PR #879 (user action).
2. Migration delete race (#85, review partial 3): a global reinstall of the same root between the
   last live-registry read and `fs.rm` in `decideRoot` can still lose the root. A full fix needs a
   cross-process lock; user was asked whether to open a separate small task. No answer yet.
3. MCP registry API break (pre-existing, not Phase D): `/v0.1/servers/{name}` returns 404; new path
   `/versions/latest` with `packages`/`remotes` schema. User has a prompt for a new session.
4. Known limitations (in PR body): `apps/ptah-cli` MCP commands ignore the new failure `code`;
   VS Code/CLI keep legacy behaviour until Electron runs the migration once.
5. Remove this worktree and older ones (`session-prefix-diet-cifix`, merged B/C/cli-lane) only
   after the user authorizes it.

## Key files
- `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d/.ptah/specs/TASK_2026_853_897f/decisions.md` — rulings #77-#85 for the review rounds.
- `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d/libs/backend/rpc-handlers/src/lib/install-scope/install-scope-migration.service.ts` — boot migration (retire, delete proven roots, reap clones, live-registry hold).
- `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d/libs/backend/harness-sync/src/lib/sources/mcp-intent-store.ts` — MCP intent v2; corrupt/unreadable throws `McpIntentPersistError`.
- `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d/libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.service.ts` — skills.sh install, Make global, retired filtering.

## Background work
None for this task. Signals about `TASK_2026_ONBOARDING_SHARING` lanes (`6ae50735…`,
`706303c7…`, `ffa44f17…`) reached the previous session but belong to another task; ignore them.

## Next steps
1. Commit this HANDOFF.md in the foreground (`docs(docs): update Phase D handoff`), then push in
   the background.
2. Check the PR: `gh pr view 879 --json headRefOid,mergeStateStatus,reviewDecision`,
   `gh pr checks 879`, and new comments via
   `gh api repos/Hive-Academy/ptah-extension/pulls/879/comments`. Fix confirmed findings, commit in
   the foreground, push in the background, watch CI with `gh pr checks 879 --watch --interval 120`
   as a background command.
3. On the user's answer: open the lock task for the migration race, or leave it.
4. After merge and user authorization only:
   `git worktree remove .claude-worktrees/session-prefix-diet-d`.

## Rules (repeat to every subagent and lane)
- Worktree only. CI is the verifier for this PR; a needed local check is only
  `npm run verify -- -p <changed + dependent hosts>`, never workspace-wide or nx run-many.
- `git commit` in the foreground only; push in the background. Read `.commitlintrc.json`.
- Never merge, force-push, rewrite history, or remove worktrees. Do not touch
  `/home/amun/projects/.ptah`. Next decision row is #86.
