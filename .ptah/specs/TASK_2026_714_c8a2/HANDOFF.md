# Session handoff — TASK_2026_714_c8a2 (session 12)

Written 2026-10-26. Replaces the session 10/11 handoff (in git history, commit 5200e6b3a).
At handoff: no subagent, CLI lane or verify run of this task is active. The worktree has
UNCOMMITTED work for batches 8a-1 and 8d (listed below) — do not discard it.

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. Then DELETE the
two legacy paths: A = Claude Agent SDK + Codex translation proxy (main chat), B =
`@openai/codex-sdk` (CLI lanes). Claude behavior unchanged. Electron first. No runtime-selector
UI. Production stays behind the parity gate until parity is proven.

**User decision:** PR #823 is NOT merged until the App Server path runs main chat, gateways and
lanes (session handling and subagents working) AND paths A and B are removed. Defects found on the
way go out as SEPARATE small PRs that the user merges first; then `main` is merged into the
runtime branch (no rebase, no force push).

**Principle (user):** use native App Server features wherever they exist; build only where they do
not. Session decisions are rows at the end of `decisions.md`.

**Removal timing (asked by the user this session):** Removal A = P15 (needs P14 parity proof),
Removal B = P16 (needs P15 + lane parity proof). Phase order: P8 -> P9 gateway -> P10 lanes ->
S0/S1 paid spikes -> P11 native subagents -> P12 native sessions -> P13 file rewind -> S2 ->
P14 parity ledger + live Electron parity -> P15 -> P16. I offered the user an option to move
Removal B right after P10 + lane parity proof (lanes do not depend on main chat); NO answer yet —
do not reorder without the user's go.

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #824 | `fix/provider-switch-model-sync` / `.claude-worktrees/provider-switch-model-sync` | MERGED. Worktree + branch kept until the user authorizes cleanup. |
| #826 | `fix/host-stored-model-validation` / `.claude-worktrees/host-stored-model-validation` | MERGED (b72dd7a54). Now merged into the runtime branch. Worktree + branch kept. |
| #823 | `feat/codex-runtime-integration` / `.claude-worktrees/codex-runtime-integration` | DRAFT, do not merge. Pushed head: `d24de2a2c` (merge of origin/main). CI at d24de2a2c: 19 pass, 3 skipped (bench/perf); one Electron E2E flake (`permission/config-change-permission-survival.spec.ts:204`, 8 min hang) passed on re-run. Local commits on top: c8eb6ea50, 93c101ba3, 956254955, d4edc82e2 and this handoff commit — check `git log --oneline origin/feat/codex-runtime-integration..HEAD`; push them if still unpushed. |

## Done this session (session 12)

| Item | Commit | Notes |
| --- | --- | --- |
| Merge origin/main (#826) | `d24de2a2c` (pushed) | Merge rules applied: model read after the last await before `prepare()` (and after the metadata read, review M1); `resolveStoredModel` only on the Claude branch via new `ExecutionProfileRequest.requestedModelIsStored` + `prepare(config, identity, modelIsStored)`; claude-sdk `ResolvedExecutionProfile` now carries `model`; shared fallback `resolveClaudeExecution` in `chat-runtime-profile.service.ts`. Review: `code-logic-review-merge826.md` APPROVE 8/10. decisions.md row "Merge #826 (session 12)". |
| Batch 8c | `c8eb6ea50` | Codex approval decisions in the permission prompt (chat-streaming, chat). Visual review pending a live run. |
| Batch 8a-0 | `93c101ba3` | Electron codex runtime host infrastructure (`apps/ptah-electron/src/di/codex-runtime-composition.ts` + spec): bundled-root executable factory, chat-only dev gate/capabilities, per-session runtime scopes + cleanup, awaited identity initializer. Exported, NOT bound (no behavior change). |
| Batch 8e | `956254955` | CLI keeps legacy chat composition (cli-engine specs, `apps/ptah-cli/src/di/expected-resolvable.ts`). |
| Run state | `d4edc82e2` | batches.md "Run state (session 12)", decisions.md "P8 decision 1" (identity store = option A) and "P8 decision 2". |

## In progress (UNCOMMITTED in the worktree)

1. **Batch 8a-1 (rpc-handlers host ports)** — files:
   `libs/backend/rpc-handlers/src/lib/chat/codex-host/` (`codex-chat-host-ports.ts` + spec,
   `native-session-controls.ts` + spec), `libs/backend/rpc-handlers/src/index.ts` (narrow
   exports), `libs/backend/rpc-handlers/package.json` (codex-runtime dependency),
   `.ptah/specs/TASK_2026_714_c8a2/batch-8a-1b-report.md` (fix rounds 1 and 2).
   Last deciding verify: rpc-handlers lint + typecheck PASS, `rpc-handlers:test` FAIL — but that
   run started BEFORE fix round 2 landed, so fix round 2 is untested. Next: one rpc-handlers
   verify; commit if green.
   Open: ProviderInfo in the 8a-1 spec uses providerId `'ptah-cli'` because shared `ProviderId`
   (`libs/shared/src/lib/types/ai-provider.types.ts:12`) has no Codex value; the factory takes
   `info` as input, so 8a-2 decides (do not keep a wrong label; record the gap or add the value).
2. **Batch 8d (VS Code compatible bindings)** — files: `apps/ptah-extension-vscode/src/di/`
   `expected-resolvable.ts`, `container.smoke.spec.ts`, `rpc-surface.spec.ts`,
   `surface-composition.spec.ts`; `.ptah/specs/TASK_2026_714_c8a2/batch-8d-report.md`.
   `ptah-extension-vscode:test` FAILS on two spec defects:
   - `surface-composition.spec.ts:95-99`: `readFileSync` result typed `string | Buffer`
     (TS2339/TS2345) — pass `'utf8'` / type it as string.
   - `rpc-surface.spec.ts`: asserts `chat:sendMessage` and `config:model-switch` /
     `effort-set` / `autopilot-toggle`, which are not in the VS Code surface list — assert the
     real names.
   Next: fix, verify `-p ptah-extension-vscode`, commit.

## Open problems and decisions

- **P8 decision 1 (coordinator, this session):** no persistent `CodexThreadIdentityStore` exists
  (interface `libs/backend/codex-runtime/src/lib/codex-runtime-ports.ts:33`, no implementer).
  Option A chosen: agent-sdk implements it on the existing `SessionMetadataStore` as new batch
  **8a-1c**, before 8a-2. Conditions: store ONLY the identity mapping (threadId, contextId,
  processGeneration, normalizedHome, workspaceId, active state) — history stays in the App Server
  thread, resume via native `thread/resume`; one source of truth with
  `SESSION_RUNTIME_IDENTITY_LOOKUP`; old `codexExecution` records stay readable (spec for an old
  record); `persist()` is an awaited write before the first turn (failure refuses the launch with
  a typed error); `markInactive` compares generation before it writes. The user was told and may
  still prefer B (separate SQLite table) or C (in-memory) — if the user answers, follow it.
- **Accepted team-leader decisions:** FM-R5 = one logical owner per write (no settings-core
  transaction API, per code-logic-rereview-p7.md:119-122); initial control settings come from
  `profile()` (needs 8a-1c); event callbacks composed in 8a-2 from existing observers.
- **8c follow-ups:** wire mapping accept->allow, acceptForSession->always_allow,
  decline->deny_with_message (no reason), cancel->deny; NO backend reverse mapping to Codex
  decisions yet — 8b must add it. chat-ui inline card still renders Claude buttons when a Codex
  request matches a tool node (disallowed clicks are blocked) — chat-ui follow-up.
- **Phase-review check:** native persistence writes through `WorkspaceScopeResolver`, the config
  RPC through its settings handles — confirm the same keys and scopes.
- **Still open from #824 (not fixed):** picker label shows `tab.sessionModel` with no override;
  reassign dialog does not preselect the workspace model; Codex reassign to "This workspace" also
  writes the global tier map; no host push event for changes from CLI/another window.
- **Deferred items** (reasons in batches.md): live session stats, `review/start`, title param of
  `updateCodexExecution`, store workspace-key rules, register.ts max-lines, model list with no
  open session, VS Code/CLI cache gap, accumulator replay spec, cancel during `prepare()`,
  cache-write tokens inside inputTokens.
- **Network:** github.com git HTTPS sometimes fails (`Failed to connect to github.com port 443`);
  `gh` API works. Retry a failed push/fetch once (it worked on retry this session).
- **Process lessons:** CLI lanes give up while waiting on the FIFO lock (3-5 min) and never
  verify — the team-leader must run every deciding verify itself. Lanes sometimes write files
  beyond their declared deliverables (8e wrote 4, declared 2) — check `git status`. Lane reports
  arrive at the coordinator; forward them to the team-leader. The team-leader used ~230k context
  in this session; start a FRESH one per resume with a short handoff.

## Key files

- Task folder: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/`
  (`batches.md` = source of truth incl. "Run state (session 12)", P8 batches from ~line 1502,
  "Batch 7d carried rules" ~1448, "Session 7 plan" ~978; `decisions.md`; batch reports
  `batch-8a-1-report.md`, `batch-8a-1b-report.md`, `batch-8c-report.md`, `batch-8d-report.md`,
  `batch-8e-report.md`; `code-logic-review-merge826.md`).
- P8 code: `apps/ptah-electron/src/di/codex-runtime-composition.ts` (+ spec),
  `libs/backend/rpc-handlers/src/lib/chat/codex-host/`, Electron DI guards in
  `apps/ptah-electron/src/di/` (`phase-2-libraries.ts`, `expected-resolvable.ts`,
  `container.smoke.spec.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`).
- Runtime contracts: `libs/backend/codex-runtime/src/lib/codex-runtime-ports.ts`,
  `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`,
  `libs/backend/agent-sdk/src/lib/wiring/` (identity cache, codex-chat-metadata-port).
- P7/merge code: `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts`,
  `chat-session.service.ts`, `chat-slash-command-router.service.ts`,
  `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts`.

## Next steps (in order)

1. In the worktree: `git status -sb`; `git log --oneline origin/feat/codex-runtime-integration..HEAD`.
   If commits are unpushed: `git push origin feat/codex-runtime-integration` in the background
   (retry once on a network error), then watch `gh pr checks 823`.
2. Start a FRESH team-leader (Mode 2) with a short handoff prompt (absolute paths, keep context
   small) for:
   a. 8a-1: `npm run verify -- -p @ptah-extension/rpc-handlers`; commit if green.
   b. 8d: fix the two spec defects above; `npm run verify -- -p ptah-extension-vscode`; commit.
   c. 8a-1c: thread identity store (option A + conditions above) in agent-sdk;
      `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers`.
   d. 8a-2: Electron binding + callbacks + ProviderInfo decision; then 8b (IPC approval ownership
      + reverse mapping of Codex decisions).
   Gates for 8a-1c/8a-2/8b: `node scripts/verify.mjs --exec --task di-lint -- npx nx run di-lint:lint`
   and `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.
   STOP before any live Electron run or paid model call, and at the P8 phase review.
3. P8 phase review (Claude code-logic, plus code-style for the new public API in rpc-handlers
   index.ts and agent-sdk), fix rounds, then the 8c visual review in Electron (dark + light) —
   live run only with the user's go.
4. Before any live Electron test: ask the user. Paid runs only `haiku` and Codex luna, tiny
   prompts, <=10 turns. Back up `~/.ptah/settings.json` into a new `%TEMP%` folder and restore it
   byte-identical (`cmp`). Do not edit it without the user's go.
5. Then P9 (gateway), P10 (lanes) per batches.md.

## Verification rules (repeat to every lane)

- `npm run verify -- -p A,B` / `npm run verify -- -t test -p A` (extra Jest flags after a second
  `--`). FIFO lock is machine-wide; `node scripts/verify.mjs --status`. Other heavy commands:
  `node scripts/verify.mjs --exec --task <name> -- <cmd>`. Never workspace-wide, never `nx
  run-many`, never positional `nx test A B`, never build/serve/dev/e2e/package unless for an
  approved Electron live run. A lane's queued verify vanishes when the lane exits.
- Known noise: `translation-proxy.sdk.integration.spec.ts` EPERM on Windows; agent-sdk lint 2
  errors in `session-query-executor.accounts.spec.ts:174,183`; auth-providers 3 lint errors
  (package.json dependency-checks, `provider-account.store.spec.ts:132`,
  `provider-account.store.ts:16`); cli-agent-runtime 5-6; core 2; chat / rpc-handlers lazy-load
  static-import errors/warnings; di-lint `__fixtures__` ERROR lines are its self-test output;
  Electron E2E `config-change-permission-survival.spec.ts:204` flaked once (passed on re-run).
- Never run npm ci / npm install in a worktree (node_modules is a junction).
- Lane deliverable paths MUST be absolute and declared at spawn. Lanes do not commit or push.
- No `as unknown as`, `any`, `@ts-ignore` or `eslint-disable` added by this task.
- Commit in the foreground, explicit paths, `.commitlintrc.json` (scope `task-specs` for docs),
  subject <=72, body lines <=100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Push in the background. No merge of PRs, force push, history rewrite, branch deletion or worktree
  removal. Never commit log files.

## Electron live-test procedure (run from the worktree under test, only with the user's go)

1. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx build-dev ptah-electron`
2. `node scripts/copy-wasm.js dist/apps/ptah-electron`
3. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx copy-renderer-dev ptah-electron`
4. `PTAH_NO_DEVTOOLS=1 PTAH_DB_PATH=… PTAH_SESSIONS_DB_PATH=… node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9335 <ws>`
- Port 9335 only. Drive with Playwright `connectOverCDP`; reusable scripts in
  `%TEMP%/ptah-live-test-3/` (`cdp.js`, `s-reassign2.js`, `s-confirm-save.js`, `s-newsession.js`,
  `s-send.js`, `sdiff.js`). Send marker in the log:
  `[SessionLifecycle] Starting SDK query with options: {"model":...}`. Stop the app with
  `taskkill /T /F` on the root `electron.exe` of the worktree. Native dev route:
  `PTAH_CODEX_RUNTIME_DEV=1` on an unpackaged build (chat only).
