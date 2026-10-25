# Session handoff — TASK_2026_714_c8a2 (session 9)

Written 2026-10-25. Replaces the session 8 handoff (in git history, commit 42dcdb00f).
No subagent, CLI lane or verify lock of this task is active at handoff (checked with
`node scripts/verify.mjs --status`; the previous Claude process exited while team-leader and the
6b fix lane were still running, so both stopped mid-round).

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
not. Session decisions are rows at the end of `decisions.md`.

## Decisions made this session (add as rows to decisions.md — NOT yet written there)

- M3 (host stored-model fallback): **validate on the host** (user, session 9). Implemented in PR
  #826 (see below).
- Resume after a workspace provider switch: **keep allowed** (user, session 9). No code change.
- 6a: an "edit" approval reply = decline + `editNotSupported` + injected follow-up message (core
  `ApprovalSink` cannot carry a reason or replacement). Team-leader: matches the batch plan.
- 6c: legacy YOLO maps through `PERMISSION_MODE_MAP` (yolo -> SDK 'default', level 'yolo'; NOT
  'bypassPermissions', which disables canUseTool). Legacy `max` effort keeps today's behavior:
  live `xhigh`, persisted `max`, timing `nextTurn`.

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #824 | `fix/provider-switch-model-sync` / `.claude-worktrees/provider-switch-model-sync` | MERGED into main (`b5c9c8047`). Worktree + branch kept until the user authorizes cleanup. |
| #826 | `fix/host-stored-model-validation` / `.claude-worktrees/host-stored-model-validation` | OPEN, ready. Head `bc1b2cad5`. CI was all green on `b103675ed` (19 pass); CI on `bc1b2cad5` was not watched yet. One CodeRabbit finding fixed in `bc1b2cad5` and replied to. Needs: CI watch, CodeRabbit re-check, user merge. |
| #823 | `feat/codex-runtime-integration` / `.claude-worktrees/codex-runtime-integration` | DRAFT, do not merge. Pushed head `ef4e34932` (merge of origin/main incl. #824), CI all green there (19 pass). Local commits on top: `a566781a5` (6a), `a65ff9595` (6c), plus this handoff commit. |

All worktrees are under `D:/projects/ptah-extension/.claude-worktrees/`. `node_modules` in each is
a junction (never `npm ci`/`npm install`; before any `git worktree remove`, run
`cmd /c rmdir node_modules`).

### #824 (merged) — what it fixed

D1-D3 provider-switch model sync; Save no longer waits for the model/effort re-reads (the e2e
fixture leaves `config:models-list` unanswered); `EffortStateService` read/write guard (R2-M1);
CodeRabbit: saved-model option uses the live catalog alone when cached; picker fallback for a
rejected override matches `resolveValidModel`; auth-status reads are sequenced (superseded
response discarded, its caller resolves with the newest read; a superseded read that applied a
provider leaves the re-sync to the newest read). Electron scenario 2 PASS live (luna -> haiku in
the same open session; 2 paid turns; settings restored byte-identical).
Still open from #824 (follow-ups, not fixed): picker label shows `tab.sessionModel` when there is
no override (send uses `currentModel`); reassign dialog does not preselect the workspace model and
a Codex reassign to "This workspace" also writes the global tier map; no host push event for
changes from the CLI or another window.

### #826 (open) — M3 host stored-model check

- Root cause (confirmed by review): `ModelSettings.selectedModel` reads the ACTIVE workspace's
  provider slot; the send is served by the SESSION workspace's provider
  (`resolveProviderProfileForWorkspace`). A gateway turn, resume or slash relaunch for another
  workspace could send a wrong-provider model (e.g. Codex id to Anthropic).
- Fix: `WorkspaceProviderProfileResolver.resolveStoredModel(workspacePath, storedModel)` in
  auth-providers, rule in `libs/backend/auth-providers/src/lib/auth/stored-model-offer.ts`.
  Allow-by-default: replace with `'default'` only when another provider offers the model AND the
  serving provider does not (cached catalog or registry staticModels). Claude ids/aliases
  (case-insensitive, `[1m]` suffix), `default`, tier aliases, `opusplan` and unknown/custom ids
  pass through. Cache-only, info log, stored settings unchanged, explicit request model skips it.
  Call sites: `chat-session.service.ts` (start/child/handoff, continue resume),
  `chat-slash-command-router.service.ts`, `gateway-chat-bridge.ts`.
- Review: REVISE (strict rule rejected `opus[1m]` and custom ids) -> revised -> APPROVE.
  Non-blocking notes in the PR body: root cause stays (no path-scoped model read), write path
  unchecked, a generic id shared by two third-party providers can fall back on a stale catalog.
- Verify (round 1+2): rpc-handlers 4628 pass, gateway-chat-bridge 133 pass, auth-providers 2004
  pass except known EPERM spec; typecheck pass incl. `ptah-electron` (round 1). After
  `bc1b2cad5`: `npm run verify -- -t test,typecheck -p @ptah-extension/rpc-handlers` PASS.
- `chat-session.service.ts` has ~60 unformatted lines from main's accounts feature (Prettier
  warns on the file; not this PR's lines). Do not reformat in this PR.

## Runtime branch — P6 state (batches.md is the source of truth; its Run state is UNCOMMITTED)

- COMMITTED (verified by team-leader): 6a `a566781a5` (chat events, approval sink, session
  approval router; `@ptah-extension/codex-runtime` added to agent-sdk package.json), 6c
  `a65ff9595` (session runtime router, legacy session controls).
- UNCOMMITTED in the runtime worktree, NOT fully verified:
  - **6b** (untracked): `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts`
    (+spec), `routing-agent-adapter.ts` (+spec), `.ptah/specs/TASK_2026_714_c8a2/batch-6b-report.md`.
    The first 2-project verify showed both 6b specs FAIL on invalid `SessionId` fixtures (6d's
    stricter identity schema). A fix lane edited both specs (fixtures + explicit guards instead of
    non-null assertions) and was STOPPED before its final test run. Resume it if useful: CLI
    session `01a17465-13b5-7833-a184-1670b2443723`. Original 6b lane:
    `01a17449-6a8c-7791-af4f-990e59c6d89c`.
  - **6d** (modified): `agent-sdk` `auth-env.port.ts` (AuthOperationContext shape; optional 2nd
    param of `configureAuthentication`), `sdk-agent-adapter.ts`, `session-metadata-store.ts`
    (+spec), new `legacy-runtime-auth.spec.ts`; `shared` `session-runtime.schemas.ts`
    (normalizedHome refine) + `session-runtime.types.spec.ts`; `batch-6d-report.md`. First
    verify: shared + typechecks PASS, Electron typecheck PASS; the post-port-correction verify
    never ran (queued process vanished). 6d lane: `01a17449-c6e0-70b0-8873-d8737c0fbcdc`.
    6d plan adjustment (account overlap): `updateCodexExecution` must not read/write/require
    `accountBinding`; index rebuild keeps `preservedIndexEntry`;
    `session-metadata-store.account-binding.spec.ts` must pass unchanged.
  - `batches.md`: team-leader's session 9 Run state block + 6a/6c results (accurate except it
    says 6b/6d lanes are "running" — they are stopped).
- Known lint noise in agent-sdk: `session-query-executor.accounts.spec.ts:174,183`
  `no-unexpected-multiline` (from main; identical on origin/main).
- Notes for the P6 phase review: `SessionApprovalRouter` keeps an owner entry when the sink settles
  on timeout/abort/disposal — the composer (6b/6e) must call the `register()` release on settle;
  6c: a failed interrupt stays blocked until a successful interrupt or `releaseSession`.
- Later phases: main's Claude account choice is forwarded through vscode-lm-tools agent spawn
  args (`agent-spawn-args.schema.ts`) and the CLI; 8e/10b must keep it out of the Codex lane path.

## Next steps (in order)

1. Runtime worktree: `git status -sb`; confirm the 3 local commits (6a, 6c, handoff) are pushed
   (`git log --oneline origin/feat/codex-runtime-integration..HEAD`). If not, `git push` in the
   background. Then `gh pr checks 823 --watch` in a background Bash command.
2. PR #826: `gh pr checks 826 --watch` (background); read new review threads
   (`gh api repos/Hive-Academy/ptah-extension/pulls/826/comments`); fix confirmed findings in its
   worktree; when green, ask the user to merge. After the merge, `git fetch origin && git merge
   origin/main` in the runtime worktree (no rebase/force), scoped checks, push.
3. Record the session 9 decisions (above) as rows in `decisions.md`.
4. Re-invoke team-leader (Mode 2) for P6 with absolute paths: verify 6d
   (`npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/shared`, plus
   `-t typecheck -p @ptah-extension/auth-providers,ptah-electron`), fix/verify the 6b specs
   (resume lane `01a17465-...` or a new small lane), commit 6d then 6b, fix the Run state text,
   then 6e, host typecheck (`npm run verify -- -t typecheck -p
   ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`), then STOP for the P6 phase review
   (code-logic + code-style, Claude reviewer).
5. Then P7 (7a substitution notice, 7b, 7c — the #824 fence is lifted), P8 (8a Electron dev
   switch wiring; M2 check: Electron passes `app.isPackaged` verbatim), and the order in
   batches.md ("Session 7 plan").

## Verification rules (repeat to every lane)

- `npm run verify -- -p A,B` / `npm run verify -- -t test -p A` (extra Jest flags after a second
  `--`). This Nx prints `NX N tasks: ...`; `-- --output-style=static` shows the "Running target"
  header. FIFO lock is machine-wide; `node scripts/verify.mjs --status`. Other heavy commands:
  `node scripts/verify.mjs --exec --task <name> -- <cmd>`. Never workspace-wide, never `nx
  run-many`, never positional `nx test A B`, never build/serve/e2e unless for an approved
  Electron live run. Queued verify processes of a lane can vanish when the lane exits.
- Known noise: `translation-proxy.sdk.integration.spec.ts` EPERM on Windows; lint errors in
  auth-providers (3, main's account files), cli-agent-runtime (5-6), core (2,
  attention-permission-actions), agent-sdk (2, session-query-executor.accounts.spec.ts),
  rpc-handlers/chat (module-boundary "Static imports of lazy-loaded libraries").
- Lane deliverable paths MUST be absolute.
- Commit in the foreground, explicit paths, `.commitlintrc.json` (scope `task-specs` for docs),
  subject <=72, body lines <=100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Push in the background. No merge, force push, history rewrite, branch deletion or worktree
  removal. Do not edit `~/.ptah/settings.json` without the user's go.

## Electron live-test procedure (run from the worktree under test)

1. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx build-dev ptah-electron`
2. `node scripts/copy-wasm.js dist/apps/ptah-electron`
3. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx copy-renderer-dev ptah-electron`
4. `PTAH_NO_DEVTOOLS=1 PTAH_DB_PATH=… PTAH_SESSIONS_DB_PATH=… node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9335 <ws>`
- Port 9335 only. Back up `~/.ptah/settings.json` into a new `%TEMP%` folder first and restore it
  byte-identical (`cmp`). Drive with Playwright `connectOverCDP`; reusable scripts in
  `%TEMP%/ptah-live-test-3/` (`cdp.js`, `s-reassign2.js`, `s-confirm-save.js`, `s-newsession.js`
  + click "Create", `s-send.js`, `sdiff.js`). Send marker in the log:
  `[SessionLifecycle] Starting SDK query with options: {"model":...}`. Stop the app with
  `taskkill /T /F` on the root `electron.exe` of the worktree.
- Paid runs: only `haiku` and Codex luna, tiny prompts, <=10 turns per run.

## Key files

- Task folder: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/`
  (`batches.md`, `implementation-plan.md`, `decisions.md`, `research-codex-gaps.md`,
  `batch-6a-report.md` .. `batch-6d-report.md`).
- P6 code: `libs/backend/agent-sdk/src/lib/codex-app-server/`, `session-metadata-store.ts`,
  `sdk-agent-adapter.ts`, `auth-env.port.ts`; `libs/shared/src/lib/types/session-runtime.schemas.ts`.
- Gate: `libs/backend/codex-runtime/src/lib/di/registration.ts`, `codex-parity-gate.ts`,
  `codex-dev-route.ts`.
- M3: `libs/backend/auth-providers/src/lib/auth/stored-model-offer.ts`,
  `workspace-provider-profile-resolver.ts` (in the #826 worktree).
