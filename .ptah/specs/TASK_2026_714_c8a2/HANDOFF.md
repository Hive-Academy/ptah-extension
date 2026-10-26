# Session handoff — TASK_2026_714_c8a2 (session 13)

Written 2026-10-26. Replaces the session 12 handoff (in git history, commit 570641c22).
At handoff: no subagent or CLI lane of this task is running. The team-leader was stopped when the
previous Claude process exited. One orphaned verify process of this worktree may still sit in the
FIFO queue (pid 21524, `verify lint,test,typecheck (@ptah-extension/rpc-handlers)`); nobody reads
its result — ignore it or let it finish. The worktree holds UNCOMMITTED work for batches 8a-2a and
8a-2b (listed below) — do not discard it.

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. Then DELETE the
two legacy paths: A = Claude Agent SDK + Codex translation proxy (main chat), B =
`@openai/codex-sdk` (CLI lanes). Claude behavior unchanged. Electron first. No runtime-selector
UI. Production stays behind the parity gate until parity is proven.

**User decisions:**
- PR #823 is NOT merged until the App Server path runs main chat, gateways and lanes (session
  handling and subagents working) AND paths A and B are removed. Defects found on the way go out
  as SEPARATE small PRs that the user merges first; then `main` is merged into the runtime branch
  (no rebase, no force push).
- Use native App Server features wherever they exist; build only where they do not.
- Identity store = option A (SessionMetadataStore) — CONFIRMED by the user in session 13.
- Removal B moves to the END of P10 (after lanes run on the App Server and pass the lane parity
  proof) — CONFIRMED by the user in session 13 (decisions.md "P8 D5"). Removal A stays P15.
  Phase order: P8 -> P9 gateway -> P10 lanes (+ Removal B at its end) -> S0/S1 paid spikes ->
  P11 native subagents -> P12 native sessions -> P13 file rewind -> S2 -> P14 parity ledger +
  live Electron parity -> P15 Removal A.
- Ask the user before ANY live Electron test (including the 8c visual review) and any paid call.

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #823 | `feat/codex-runtime-integration` / `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration` | DRAFT, do not merge. origin = `64cad6713`. Local HEAD = `570641c22` (1 unpushed docs commit). CI at 64cad6713: 18 pass, 3 skipped, 2 FAIL = degradation-audit ratchet (see Open problems) + the `main` summary check. |
| #824, #826 | `fix/provider-switch-model-sync`, `fix/host-stored-model-validation` | MERGED. Worktrees + branches kept until the user authorizes cleanup. |

## Done in session 13

| Item | Commit | Verify |
| --- | --- | --- |
| Batch 8d (VS Code guard specs) | `25326130c` (pushed) | `-p ptah-extension-vscode` pass |
| Batch 8a-1 (rpc-handlers codex host ports; agent-sdk `approvals` narrowed to `Pick<SessionApprovalRouter,'register'\|'respond'\|'cancelPrompt'>`) | `d8b8122fe` (pushed) | `-p @ptah-extension/rpc-handlers` pass |
| Batch 8a-1c (persistent `CodexThreadIdentityStore`; `codexThread` field beside `codexExecution`; factory `createCodexThreadIdentityStore(lookup, metadataStore)`, no DI token) | `f853ff5bc` (pushed) | agent-sdk + rpc-handlers test/typecheck pass, agent-sdk lint only known errors, di-lint pass, 4-host typecheck pass |
| CI fix: Codex approvals via `webviewManager.broadcastMessage` + host-attention release | `9cb10a20f` (pushed) | rpc-handlers + vscode-core host-attention specs pass |
| 8a-2 Part A: `'codex-app-server'` added to shared `ProviderId` | `5f33eae1c` (pushed) | shared + rpc-handlers pass, 4-host typecheck pass |
| Run state session 13 (batches.md:931) | `64cad6713` (pushed) | docs |
| Coordinator decisions P8 D1-D6 + blocker 5/6 row (decisions.md end) | `570641c22` (NOT pushed) | docs |
| CI flake on 315c6a98f: Electron E2E `state.spec.ts:41` — passed on re-run (P8 D6) | — | — |

## In progress (UNCOMMITTED in the worktree, all unverified)

1. **Batch 8a-2a** (Codex CLI lane, ended OK; resume id `01a17843-1271-7c60-a579-b6b2463b7a60`;
   report `batch-8a-2a-report.md`): `libs/backend/codex-runtime/src/lib/codex-executable-pin.ts`
   (+ spec), `libs/backend/codex-runtime/src/index.ts`, `libs/shared/src/lib/types/branded.types.ts`
   (+ spec; `UUID_REGEX` accepts version 4 and 7, variant kept). Check: the pin module loads the
   bundled JSON with `require` + Zod — confirm it works in the Electron bundle and passes the
   lint/boundary rules. Stale comments in `wire-parsers.equivalence.spec.ts:67,466`.
   Gates: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/codex-runtime` (+ shared
   consumers), di-lint, 4-host typecheck, degradation audit.
2. **Batch 8a-2b** (Codex CLI lane, ended OK; resume id `01a17843-7437-7860-85cf-715c34afca74`;
   report `batch-8a-2b-report.md`): `libs/backend/rpc-handlers/src/lib/chat/codex-host/`
   `codex-chat-event-callbacks.ts` (+ spec), `codex-session-settings-record.ts` (+ spec),
   `libs/backend/rpc-handlers/src/index.ts`, `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts`
   (UUID v7 cases). Lane-flagged items (read its report): CRITICAL — callbacks need the key
   `JSON.stringify([threadId, turnId])` but `callbacks(sessionId)`/content payloads carry no
   `turnId`; decide where it comes from before 8a-2c (prefer the native turnId from App Server
   turn notifications). Also: compaction trigger/preTokens, failed-compaction UI side effects,
   image/file rendering, possible double presentation of approvals (callbacks vs
   `presentation.present`), host lifecycle discardProfile/release/dispose wiring.
   Gates: `npm run verify -- -p @ptah-extension/rpc-handlers`, degradation audit, di-lint, 4-host typecheck.

## Open problems and decisions

- **CI FAIL on 64cad6713 — degradation-audit ratchet:** `libs/backend/rpc-handlers: 3 FAIL
  (baseline 1)`. New violations from 8a-1/9cb10a20f:
  `codex-chat-host-ports.ts:124` and `:273` `.catch(failed)` — the audit cannot prove `failed`
  logs or rethrows. Fix: inline handler that calls the injected Logger with the real Error (or
  rethrows); do NOT raise the baseline; suppression comment only in the exact form
  `tools/degradation-audit` expects and only if intentional. Not fixed yet.
  Local gate: `node scripts/verify.mjs --exec --task degradation-audit -- npx nx run degradation-audit:lint`
  (filter to the rpc-handlers line and `FAIL`). nx affected does NOT run this audit, nor the
  vscode-core `host-attention-ingress.spec.ts` source scan — add both to deciding gates.
- **Decisions already made (decisions.md end):** D1 re-split 8a-2a -> 8a-2b -> 8a-2c -> 8b;
  D2 event callbacks = new rpc-handlers factory onto existing broadcaster/chat messages (log-only
  rejected); D3 SessionId accepts UUID v4 and v7 (App Server thread ids are UUIDv7 per
  `codex-app-server-protocol.schema.json:20434`; Ptah uses threadId as SessionId at
  `codex-chat-adapter.ts:227`); D4 8b removes a decided request from the pending map; blocker 5/6
  need no product decision (auth key via `resolveAuthProviderKey`, `CodexHomeAuthService` +
  native `account/*` notifications).
- **8a-2c (not started):** Electron binding ~8 files: `apps/ptah-electron/src/di/codex-runtime-composition.ts`
  (+ spec), `bootstrap.ts` (awaited identity setup before `registerRpcSurface`), `shutdown.ts`
  (disposal), four Electron DI guard specs. Create the scope factory only when native Codex is on
  (it throws when the bundled binary is missing).
- **8b (not started):** `ipc-bridge.ts:416` reply routing + reverse mapping allow->accept,
  always_allow->acceptForSession, deny_with_message->decline, deny->cancel; pending-map cleanup (D4).
- **For the P8 phase review:** one record holds workspaceId raw (`codexThread`) and normalized
  (`codexExecution`) — check every comparison; native persistence writes through
  `WorkspaceScopeResolver` vs config RPC settings handles — same keys/scopes; new public API in
  rpc-handlers, agent-sdk and codex-runtime index.ts (code-style review).
- **Still open from #824 (not fixed):** picker label shows `tab.sessionModel` with no override;
  reassign dialog does not preselect the workspace model; Codex reassign to "This workspace" also
  writes the global tier map; no host push event for changes from CLI/another window.
- **Deferred items** (reasons in batches.md): live session stats, `review/start`, title param of
  `updateCodexExecution`, store workspace-key rules, register.ts max-lines, model list with no
  open session, VS Code/CLI cache gap, accumulator replay spec, cancel during `prepare()`,
  cache-write tokens inside inputTokens. 8c chat-ui follow-up: inline card still renders Claude
  buttons for a Codex request matching a tool node.
- **Network:** github.com git HTTPS sometimes fails (`Failed to connect to github.com port 443`);
  retry once — it worked on retry every time in session 13.
- **Process lessons:** CLI lanes never run verify (they give up on the lock) — the team-leader runs
  every deciding verify. Lane and sub-subagent reports arrive at the coordinator; forward them
  to the team-leader with SendMessage (include the CLI resume id). Start a FRESH team-leader per
  resume with a short prompt (previous ones reached 150k+ context).
- **Side task (user):** a prompt for memory-aware verify admission was handed to the user for a
  separate session. CLAUDE.md now says the lock has 2 slots (second slot only with >= 8 GB free
  and after a 30 s settle). Not part of this task.

## Key files

- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batches.md` — source of truth; "Run state (session 13)" at line 931; P8 batches ~1502.
- `.../TASK_2026_714_c8a2/decisions.md` — decision rows; P8 D1-D6 and blocker 5/6 at the end.
- `.../TASK_2026_714_c8a2/batch-8a-2-report.md` — the 7 blockers that caused the 8a-2 re-split.
- `.../TASK_2026_714_c8a2/batch-8a-2a-report.md`, `batch-8a-2b-report.md` — uncommitted lane work.
- `.../libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts` — approval presentation; degradation violations at :124, :273.
- `.../libs/backend/agent-sdk/src/lib/wiring/codex-thread-identity-store.ts` — 8a-1c store.
- `.../libs/backend/codex-runtime/src/lib/codex-runtime-ports.ts` — runtime contracts.
- `.../apps/ptah-electron/src/di/codex-runtime-composition.ts` — 8a-0 host infra, bound in 8a-2c.
- `.../libs/backend/vscode-core/src/api-wrappers/host-attention-ingress.spec.ts` — source-scan guard for permission emissions.

## Background work

None of this task. (pid 21524 above is an orphaned queued verify with no reader.)

## Next steps (in order)

1. In the worktree: `git status -sb`; `git log --oneline origin/feat/codex-runtime-integration..HEAD`
   (expect `570641c22` and the session 13 handoff commit). Push them in the background (retry
   once on a network error).
2. Start a FRESH team-leader (Mode 2) with a short prompt (absolute paths) for:
   a. Fix the degradation-audit violations (`codex-chat-host-ports.ts:124,:273`) — small fix commit.
   b. Verify + commit 8a-2a (gates above).
   c. Resolve the turnId prerequisite, verify + commit 8a-2b.
   d. 8a-2c, then 8b.
   Gates for every batch: scoped `npm run verify -- -p <changed>`; degradation audit;
   `node scripts/verify.mjs --exec --task di-lint -- npx nx run di-lint:lint`;
   `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`;
   when permission emission changes: `npm run verify -- -t test -p @ptah-extension/vscode-core -- --testPathPatterns=host-attention-ingress`.
   STOP before any live Electron run or paid call, and at the P8 phase review.
3. After each team-leader commit set: push in the background, watch `gh pr checks 823`, fix real failures.
4. P8 phase review (code-logic + code-style for the new public API), fix rounds.
5. Ask the user before the 8c visual review / any live Electron test (procedure below).
6. Then P9 (gateway), P10 (lanes, Removal B at the end) per batches.md.

## Verification rules (repeat to every lane)

- `npm run verify -- -p A,B` / `npm run verify -- -t test -p A` (extra Jest flags after a second
  `--`). FIFO counting lock is machine-wide; `node scripts/verify.mjs --status`. Other heavy
  commands: `node scripts/verify.mjs --exec --task <name> -- <cmd>`. Never workspace-wide, never
  `nx run-many`, never positional `nx test A B`, never build/serve/dev/e2e/package unless for an
  approved Electron live run. A lane's queued verify vanishes when the lane exits.
- Known noise: `translation-proxy.sdk.integration.spec.ts` EPERM on Windows; agent-sdk lint 2
  errors in `session-query-executor.accounts.spec.ts:174,183`; auth-providers 3 lint errors
  (package.json dependency-checks, `provider-account.store.spec.ts:132`,
  `provider-account.store.ts:16`); cli-agent-runtime 5-6; core 2; chat / rpc-handlers lazy-load
  static-import errors/warnings; di-lint `__fixtures__` ERROR lines are its self-test output;
  degradation-audit self-test fixture violations are expected; Electron E2E
  `config-change-permission-survival.spec.ts:204` and `state.spec.ts:41` flaked once each
  (passed on re-run).
- Never run npm ci / npm install in a worktree (node_modules is a junction).
- Lane deliverable paths MUST be absolute and declared at spawn. Lanes do not commit or push.
  Check `git status` for files beyond the declared set.
- No `as unknown as`, `any`, `@ts-ignore` or `eslint-disable` added by this task.
- Commit in the foreground, explicit paths, `.commitlintrc.json` (scope `task-specs` for docs),
  subject <=72, body lines <=100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Push in the background. No merge of PRs, force push, history rewrite, branch deletion or
  worktree removal. Never commit log files. Do not edit `~/.ptah/settings.json` without the user's go.

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
- Paid runs only `haiku` and Codex luna, tiny prompts, <=10 turns. Back up `~/.ptah/settings.json`
  into a new `%TEMP%` folder and restore it byte-identical (`cmp`).
