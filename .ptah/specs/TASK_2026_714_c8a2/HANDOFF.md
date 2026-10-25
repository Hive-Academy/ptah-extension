# Session handoff — TASK_2026_714_c8a2 (session 8)

Written 2026-10-25. Replaces the session 7 handoff (still in git history, commit 7335067e2).
No subagent, CLI lane or verify lock is active at handoff. Two branches and two PRs are in
flight: the runtime branch (this task) and a separate fix branch for provider-switch defects.

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. Then DELETE the
two legacy paths: A = Claude Agent SDK + Codex translation proxy (main chat), B =
`@openai/codex-sdk` (CLI lanes). Claude behavior unchanged. Electron first. No runtime-selector
UI. Production stays behind the parity gate until parity is proven.

**User decision:** the runtime PR is NOT merged until the App Server path runs main chat, gateways
and lanes (session handling and subagents working) AND paths A and B are removed. Defects found on
the way go out as SEPARATE small PRs that the user merges first; then `main` is merged into the
runtime branch (no rebase, no force push).

**Principle (user):** use native App Server features wherever they exist; build only where they do
not. All session-7 decisions are recorded as rows at the end of `decisions.md`.

## PR 1 — fix: #824 `fix/provider-switch-model-sync`

- https://github.com/Hive-Academy/ptah-extension/pull/824 (ready for review, not draft).
- Worktree `D:/projects/ptah-extension/.claude-worktrees/provider-switch-model-sync`, base `16c6455e1`.
- Head `c61ab5f43`. Commits:
  - `884ff738f` fix(rpc-handlers,core,chat,dashboard): sync models on provider switch (D1 saved
    non-tier model offered; D2 AuthStateService re-sync on provider identity change, not awaited
    inside the auth read, fresh models read + generation guard, failed-first-read sentinel; D3
    `config:model-get` is a pure read).
  - `c61ab5f43` fix(core): re-read model and effort after a settings save (live-rerun defect:
    first Codex -> Claude switch saved with a workspace model sent on global `opus`, because the
    re-sync models read landed before `config:model-switch`). `ProvidersCommitService` now calls
    `refreshModels({ fresh: true })` / `refreshEffort()` after the writes, resolved lazily via
    `Injector.get`.
- CI: all green on `884ff738f`. On `c61ab5f43` CI was PENDING at handoff (3 pass, 15 pending).
  CodeRabbit was rate limited on the first head.
- Reviews (`.ptah/specs/provider-switch-model-sync/code-logic-review.md` in that worktree):
  REVISE 7 -> APPROVED 8.5 -> round 2 APPROVED 8.
- Lint: the only error in changed files is `model-selector.component.ts:29`
  (enforce-module-boundaries, `@ptah-extension/shared`), same line on the base: not added by this
  PR. core lint errors (2) are in untouched `attention-permission-actions.component.ts`.
- Electron rerun on `884ff738f` (evidence in `%TEMP%/ptah-live-test-2/`: `electron.log`, `shots/`,
  scripts; settings restored byte-identical, stray `authMethod = "some-value"` left untouched):
  - Scenario 1 (Codex main chat, saved gpt-6-luna offered + used): PASS.
  - Scenario 2 (switch provider in open session): PARTIAL. Claude -> Codex PASS. Codex -> Claude:
    list/footer/send provider OK, but send used `opus` (fixed by `c61ab5f43`, NOT yet re-proven
    live) and the picker label stayed `gpt-6-luna`.
  - Scenario 3 (two workspaces isolated, no model-get rewrites): PASS.
  - Paid turns used: 7 (3 luna, 3 haiku, 1 unintended opus caused by the defect).
- Open follow-ups (documented in the PR body/comment, NOT fixed):
  - R2-M1 (moderate, narrow): `EffortStateService.loadEffort` (effort-state.service.ts:79-90) has
    no generation guard; a late sync read could overwrite the effort just saved. ~5 lines, same
    pattern as `modelsGeneration` in model-state.service.ts.
  - Picker label falls back to `tab.sessionModel` unchecked after a switch
    (`model-selector.component.ts` `effectiveModel`). A plain id check would hide valid resumed
    Claude labels (`claude-fable-5-1[1m]`), so it needs a provider-aware check. Send is correct.
  - M3: host paths that read the stored model directly when `params.model` is empty
    (`chat-session.service.ts:880,1621`, `chat-slash-command-router.service.ts:288`,
    `gateway-chat-bridge.ts:870`) can send a Codex id to Anthropic after a switch. Needs a product
    decision (validate per provider on the host, or clear on switch).
  - Reassign dialog does not preselect the workspace's saved model; saving a Codex reassign to
    "This workspace" also writes the global `provider.openai-codex.mainAgent.modelTier.opus`
    (D4 decision: tier map stays provider-level).
  - No host push event for changes from the CLI or another window.

## PR 2 — runtime: #823 `feat/codex-runtime-integration` (DRAFT, do not merge)

- https://github.com/Hive-Academy/ptah-extension/pull/823
- Worktree `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`, base
  `16c6455e1`. `node_modules` is a junction (never `npm ci`/`npm install`; before any
  `git worktree remove`, run `cmd /c rmdir node_modules`).
- Pushed head at PR open: `7335067e2`, CI ALL GREEN there. Commits on top (see "Push state" below):

| Commit | What |
| --- | --- |
| `085a9341d`, `5a7e8f989`, `953fee97d`, `52e06df02` | P5 (identity contracts, home-aware usage, profile seam, review fixes) |
| `7335067e2` | docs: session 7 decisions, research-codex-gaps.md, P5 re-review |
| `22f44920a` | docs: session 7 batch plan in batches.md |
| `0541f372b` | feat(codex-runtime): dev-only chat route override (Batch DS1, phase P5b) |
| `c2547fad9` | docs: DS1 recorded |
| `38ccfb5a0` | docs: P5b closed (code-logic-review-p5b.md APPROVED 8), 6p started |
| `389d08ce1` | feat(codex-runtime,auth-providers): shared workspace key + model substitution (Batch 6p) |
| `5e890235a` | docs: 6p recorded, "Run state" block in batches.md |
| (this file) | docs: session 8 handoff |

- Reviews: P5 logic re-review APPROVED 8.5 (`code-logic-review-p5-fixes.md`); P5b APPROVED 8
  (`code-logic-review-p5b.md`; M1 test added in 6p; M2 = acceptance check at 8a review: Electron
  passes `app.isPackaged` verbatim, no other host passes `devRoute`).
- DS1: the reader returns a route only when `isPackaged === false` and `PTAH_CODEX_RUNTIME_DEV`
  is exactly `'1'`; chat only; gateway and lane stay blocked; `CodexParityGate` still
  `enabled: false`. No host wires it yet (that is 8a).
- 6p behavior change to check at the P6 review: a stored RELATIVE workspace id is now rejected
  with a content-free error (no longer resolved against the cwd).

## Push state at handoff

- Fix branch: pushed (`c61ab5f43`).
- Runtime branch: the coordinator started `git push` of `22f44920a..` + this handoff in the
  background at the end of session 8. **First check:** `git -C <runtime worktree> status -sb` and
  `git log --oneline origin/feat/codex-runtime-integration..HEAD`. If commits are still local, push
  again in the background (`git push`), then watch CI: `gh pr checks 823 --watch`.
- Note: the jq-based Monitor watcher printed no events this session (jq output problem on this
  machine). Use `gh pr checks <n> --watch` in a background Bash command instead.

## Plan state (batches.md "Run state" block is the source of truth)

- Done: P5, P5b (DS1), 6p.
- Next: Phase P6 = 6a (chat events + approval routing in
  `libs/backend/agent-sdk/src/lib/codex-app-server/`, Codex lane, Claude reviewer) and 6c in
  parallel (file-disjoint); then 6b, 6d (now also edits
  `libs/shared/src/lib/types/session-runtime.schemas.ts` for the normalizedHome refine; verify
  `-p @ptah-extension/agent-sdk,@ptah-extension/shared`), 6e; host typecheck; then P6 phase
  review (code-logic + code-style) = next stop.
- Later order: P7 (7a substitution notice, 7b, 7c — 7c edits `config-rpc.handlers.ts` and WAITS for
  PR #824 merge + `git merge origin/main`), P8 (8a Electron wiring of the dev switch; 8c = Claude
  frontend-developer + Codex logic review + Electron visual review dark/light), P9 9b, P10 10b/10c
  (lanes keep native subagents off), S0/S1 gap spikes (paid, 8 turns approved, <=30000/turn,
  <=100000/run: revert 2-3, file edit vs shell edit 1, native subagent 1), P11 native subagents,
  P12 native sessions (`thread/read`, `thread/revert`, `thread/resume`; metadata only), P13 git
  shadow-tree file-rewind checkpoint, S2 (Always Allow different-command, remote MCP), P14 parity
  ledger + live Electron parity run, P15 Removal A, P16 Removal B (each one commit with proof).
- Team-leader moved the gap spikes before P11/P12 (they need the recorded frames); consistent with
  session-7 decision 2, recorded in batches.md.
- Lane deliverable paths MUST be absolute (a task-folder-relative path was doubled by the lane
  checker and gave a false "no-deliverable" verdict for DS1).

## Key files

- Runtime task folder `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/`:
  `batches.md`, `implementation-plan.md`, `decisions.md`, `research-codex-gaps.md`,
  `native-route-evidence.md`, `batch-DS1-report.md`, `batch-6p-report.md`,
  `code-logic-review-p5-fixes.md`, `code-logic-review-p5b.md`.
- Gate: `libs/backend/codex-runtime/src/lib/di/registration.ts`,
  `libs/backend/codex-runtime/src/lib/codex-parity-gate.ts`,
  `libs/backend/codex-runtime/src/lib/codex-dev-route.ts`.
- Subagent mapping start: `libs/backend/codex-runtime/src/lib/codex-event-translator.ts:324`.
- Protocol: `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json`.
- Fix branch: `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts`,
  `config-saved-model-option.ts`, `libs/frontend/core/src/lib/services/auth-state.service.ts`,
  `model-state.service.ts`, `providers-commit.service.ts`, `effort-state.service.ts` (R2-M1).

## Next steps (in order)

1. Check the runtime push (see "Push state"); push if needed; `gh pr checks 823 --watch` (bg).
2. PR #824: watch CI on `c61ab5f43` (`gh pr checks 824 --watch`, bg); read CodeRabbit and review
   threads (`gh pr view 824 --comments`, `gh api repos/Hive-Academy/ptah-extension/pulls/824/comments`);
   fix confirmed findings with new commits.
3. PR #824, optional small fix before the rerun: R2-M1 effort generation guard
   (+ test in effort-state.service.spec.ts); verify `npm run verify -- -t test,typecheck -p @ptah-extension/core`.
4. PR #824: rerun Electron scenario 2 (Codex -> Claude with a workspace model saved in the same
   save; expect the send on that model) on the new head, from the fix worktree, per the procedure
   below. <=4 paid turns, haiku/luna only. Report on the PR.
5. Ask the user to merge #824 when green. After the merge, in the runtime worktree:
   `git fetch origin && git merge origin/main` (no rebase/force), then scoped checks of the
   touched projects, push.
6. Re-invoke team-leader (Mode 2) to run P6 (6a + 6c first). Give it absolute paths and the rules
   below. Stops: P6 phase review, S1 paid run, user decisions, 7c merge wait.
7. Product decisions to ask the user when relevant: M3 host stored-model fallback; whether resume
   should block on a workspace provider switch (today it survives, by design per P5).

## Verification rules (repeat to every lane)

- `npm run verify -- -p A,B` / `npm run verify -- -t test -p A` (extra Jest flags after a second
  `--`). Confirm the header "Running target X for N projects". FIFO lock is machine-wide;
  `node scripts/verify.mjs --status`. Other heavy commands:
  `node scripts/verify.mjs --exec --task <name> -- <cmd>`. Never workspace-wide, never positional
  `nx test A B`, never build/serve/e2e unless for the approved Electron live run.
- Known noise: `translation-proxy.sdk.integration.spec.ts` EPERM on Windows; pre-existing lint
  errors in auth-providers (3), cli-agent-runtime (5-6), core (2, attention-permission-actions).
- Commit in the foreground, explicit paths, `.commitlintrc.json` (scope `task-specs` for docs),
  subject <=72, body lines <=100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Push in the background. No merge, force push, history rewrite, branch deletion or worktree
  removal. Do not edit `~/.ptah/settings.json` without the user's go.

## Electron live-test procedure (run from the worktree under test)

1. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx build-dev ptah-electron`
2. `node scripts/copy-wasm.js dist/apps/ptah-electron`
3. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx copy-renderer-dev ptah-electron`
4. `PTAH_NO_DEVTOOLS=1 PTAH_DB_PATH=… PTAH_SESSIONS_DB_PATH=… node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9335 <ws>`
- Port 9335 only. `--user-data-dir` is ignored in dev. `~/.ptah/settings.json` is real: back it up
  into a new `%TEMP%` folder first, restore only the keys you change, prove with `cmp`. Drive with
  Playwright `connectOverCDP`, scripts outside the repo (reuse `%TEMP%/ptah-live-test-2/`).
  A second workspace can be added via `ElectronLayoutService.addFolderByPath()` (`s-addws.js`).
- Paid runs: only `haiku` and Codex luna, tiny prompts, <=10 turns per run.
