# Session handoff — TASK_2026_714_c8a2 (session 14)

Written 2026-10-26. Replaces the session 13 handoff (in git history, commit 916ad1afc).
At handoff: NO subagent or CLI lane of this task is running. The P8 fix-round team-leader died
when the previous Claude process exited, before it verified or committed anything. The worktree
holds UNCOMMITTED, UNVERIFIED fix-round work (batches 8f-1, 8f-2, 8f-3) — do not discard it.

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. Then DELETE
legacy path B (`@openai/codex-sdk`, CLI lanes) and path A (Claude Agent SDK + Codex translation
proxy for Codex main chat). Claude behavior unchanged. Electron first. No runtime-selector UI.
Production stays behind the parity gate until parity is proven.

**User decisions (all confirmed by the user):**
- PR #823 is NOT merged by us. It is ready only when main chat, gateways and lanes run on the App
  Server AND paths A and B are removed. Defects found on the way that existed before this task
  go out as SEPARATE small PRs that the user merges first; then `main` is merged into the runtime
  branch (no rebase, no force push).
- Native App Server features wherever they exist; build only where they do not.
- Identity store = option A (SessionMetadataStore).
- Removal B at the END of P10.
- Session 14 (decision P8 D7, recorded in decisions.md): **PR scope = P8, P9 gateway, P10 lanes +
  Removal B, a live parity check (P14, now depends on P10), P15 Removal A.** P11–P13 (native
  subagents, sessions/resume, file rewind) and spikes S0–S2 move to a FOLLOW-UP PR. Consequence
  told to the user: after Removal A, Codex main chat lacks native subagents/resume/rewind until
  that follow-up.
- Session 14 (speed): per batch run ONLY the scoped `npm run verify -- -p <changed>`. Run the
  degradation audit, di-lint, the 4-host typecheck and host-attention ONCE per phase (plus di-lint
  when DI changes, host-attention when permission emission changes). ADD
  `@ptah-extension/settings-core` to scoped verify when Electron DI or settings imports change
  (CI caught TC-18 that the scoped run missed).
- Session 14: live Electron test runs right after implementation, BEFORE the phase review.
  The user approved live tests with: build-dev from the worktree, `PTAH_CODEX_RUNTIME_DEV=1`,
  Codex luna only (haiku only for a Claude regression check), tiny prompts, <=10 paid turns,
  `~/.ptah/settings.json` backed up into a new %TEMP% folder and restored byte-identical (`cmp`).
  Tell the user before each live run starts.

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #823 https://github.com/Hive-Academy/ptah-extension/pull/823 | `feat/codex-runtime-integration` / `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration` | DRAFT, do not merge. origin = local HEAD = `b35d78386`. CI at b35d78386: all pass except `test (shard 4/4)` = settings-core TC-18 (see Open problems) and the `main` summary; bench/perf skipped. |
| #824, #826 | `fix/provider-switch-model-sync`, `fix/host-stored-model-validation` | MERGED. Worktrees + branches kept until the user authorizes cleanup. |

## Done in session 14 (all pushed, head b35d78386)

| Commit | Subject | Verify (team-leader) |
| --- | --- | --- |
| 570641c22, 916ad1afc | docs: P8 decisions, session 13 handoff | docs |
| 18424ac85 | fix(rpc-handlers): log the real error for codex presentation failures | degradation audit pass, baseline unchanged |
| df836898b | feat(codex-runtime,shared): batch 8a-2a - executable pin and uuid v7 | shared + codex-runtime pass |
| b5226c69a | feat(rpc-handlers,agent-sdk): batch 8a-2b - codex event callbacks | rpc-handlers pass; agent-sdk test/typecheck pass, lint known errors only |
| fcf0127f2 | docs(task-specs): record P8 D7 scope and 8a-2 session 14 state | docs |
| 3207fdda9 | feat(electron,rpc-handlers,chat,shared): batch 8b - codex ipc approvals | 4 projects pass; host-attention pass |
| 19bbb3316 | feat(agent-sdk,rpc-handlers): batch 8a-2c-lib - codex session lifecycle | pass (known agent-sdk lint) |
| d69ca18a3 | feat(electron,agent-sdk): batch 8a-2c - electron codex chat binding | ptah-electron 1265 tests pass, di-lint OK |
| b35d78386 | docs(task-specs): record P8 batch commits, gate pass and review list | phase gate once: audit, di-lint, 4-host typecheck, host-attention all pass |

Key P8 design facts: turnId comes from the native `turn/start` receipt via
`CodexChatAdapterPorts.callbacks(sessionId, turn)`; approvals shown only by the presentation port
(callbacks never present them); adapter has optional `sessions.opened/closed` hooks that the
settings record binds to (replaced the wrapper that agent-sdk register.ts:1096 overwrote).

P8 results that drive the fix round (all files in the task folder, UNTRACKED, commit them with 8f):
- `live-test-p8.md` — FAIL at scenario a ("Codex chat open: runtime-failed"), 0 paid turns,
  settings.json restored (cmp identical). Evidence in `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8-20261026-183415\`.
  D1 blocker: dev build refuses the binary (bootstrap.ts:539-541 allowed root
  `<worktree>/dist/apps/ptah-electron/node_modules` does not exist; binary resolves through the
  node_modules junction into the main checkout; codex-runtime-composition.ts:88-98 throws
  "outside the host bundle"). D2 real error not logged. D3 UI shows "done" green after open
  failure. D4 (pre-existing #824 leftover) -> separate small PR, NOT this round.
  Next live run must set permission to an "ask" level first (new sessions open in Full Auto).
- `code-logic-review-p8.md` — NEEDS_REVISION 5.5: B1 (unguarded awaited bindElectronCodexChat at
  bootstrap.ts:535 can send boot to recovery shell), S1–S7, 9 moderate.
- `code-style-review-p8.md` — NEEDS_REVISION 6.5: S1 adapter >700 lines, S2 bindElectronCodexChat
  ~250 lines + post-handoff lifecycle mutation, S3 ipc-bridge duck-typed `unknown` port, S4 unused
  barrel exports, S5 pin JSON inlines developer binaryPath; 6 minor.

## In progress (UNCOMMITTED, UNVERIFIED — batch 8f, plan in batches.md "Batch 8f")

The batch 8f plan (batches.md diff, uncommitted) has 5 sub-batches. 8f-1..8f-3 ran as parallel
Codex lanes, all ended OK; NONE verified or committed. 8f-4 and 8f-5 NOT started.

1. **8f-1** (resume id `01a178e8-c7fd-72e0-9b81-bfdc19017e96`, report `batch-8f-1-report.md`):
   live D1 (dev/junction root), CI TC-18 (new redacted reader
   `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-legacy-session-settings.ts` + spec,
   one rpc-handlers index.ts export), B1 (guarded native-only boot binding), child-container
   cleanup, S2 (ordered, bounded shutdown; `shutdown.spec.ts`), S7 (async memoized inspection).
   Files: `apps/ptah-electron/src/activation/bootstrap.ts`, `shutdown.ts`, `shutdown.spec.ts`,
   `apps/ptah-electron/src/di/codex-runtime-composition.ts` (+ spec), `codex-binding-registry.ts`.
   Check: packaged build + binary outside the bundle MUST still throw (spec).
   Verify: `npm run verify -- -p ptah-electron,@ptah-extension/rpc-handlers,@ptah-extension/settings-core`
2. **8f-2** (resume id `01a178e9-5f9a-70a0-82e2-6dfc67f464ed`, report `batch-8f-2-report.md`):
   D2/S4 real Errors logged with cause, M2 staging before metadata persist, style S1 split
   (adapter 678 lines + new `codex-chat-turn-stream.ts` 198), style S4 (kept
   `CodexChatAdapter`/`registerCodexChatServices`, removed 21 barrel exports). Files under
   `libs/backend/agent-sdk/src/lib/codex-app-server/` + `libs/backend/agent-sdk/src/index.ts`.
   Check: re-grep apps/ and libs/ for the 21 removed names (lane grepped while others edited).
   Open: no metadata rollback after a later cancel (no rollback API) — fix or defer, record it.
   Verify: `npm run verify -- -p @ptah-extension/agent-sdk`
3. **8f-3** (resume id `01a178e9-8491-7f00-86ff-5a36a99609ab`, report `batch-8f-3-report.md`):
   style S5 + M7: typed six-field constant `libs/backend/codex-runtime/src/lib/codex-executable-pin-data.ts`
   replaces the JSON require; lazy memoized parse; manifest drift spec. Check: no developer
   binaryPath in the data; drift spec fails when the manifest changes.
   Verify: `npm run verify -- -p @ptah-extension/codex-runtime`
4. **8f-4 PENDING**: LIVE D3, logic S1 (use raw `codexThread.workspaceId` path in
   codex-session-settings-record.ts:88-118), S3 (codex-chat-host-ports.ts:307 remove pending /
   release attention only after respond succeeds; log on false), S5 (codex-chat-event-callbacks.ts:98
   final-text block + ordering before CHAT_COMPLETE; adapter side awaits reconciliation), S6
   (codex-chat-host-ports.ts:250 compare normalized keys), M3, M5. Needs 8f-1 and 8f-2.
   Verify: `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk,@ptah-extension/chat`
5. **8f-5 PENDING**: style S2 rest (split bindElectronCodexChat, no post-handoff mutation of
   record.lifecycle, declaration order), S3 (typed responder token/interface in ipc-bridge.ts),
   logic M6, style minors (registry handle, console.warn, tabId). Needs 8f-1 and 8f-4.
   Verify: `npm run verify -- -p ptah-electron,@ptah-extension/settings-core` (+ the lib exporting the responder type)

## Open problems and decisions

- **CI FAIL at b35d78386:** settings-core `settings-core.spec.ts:834` TC-18 isolation guard —
  `apps/ptah-electron/src/di/codex-runtime-composition.ts` (+ spec) import settings-core outside
  the permitted scope. 8f-1 addresses it (do NOT widen the allow-list).
- **Orphaned queued verifies** from this worktree (the dead team-leader): pid 41480
  `verify (@ptah-extension/codex-runtime)` and pid 42716
  `verify (ptah-electron,rpc-handlers,settings-core,agent-sdk)`. Nobody reads them. Check with
  `node scripts/verify.mjs --status`; if still queued and their parent is dead, kill them
  (`taskkill /PID <pid> /T /F`) so they do not hold slots. Other worktrees' entries are not ours.
- **Still open from #824 (separate small PR, not this task):** LIVE D4 — save to "This workspace"
  also writes global `provider.openai-codex.mainAgent.modelTier.*`; picker label shows
  `tab.sessionModel` with no override; reassign dialog does not preselect the workspace model; no
  host push event for changes from CLI/another window.
- **Deferred items** (reasons in batches.md): live session stats, `review/start`, title param of
  `updateCodexExecution`, store workspace-key rules, register.ts max-lines, model list with no
  open session, VS Code/CLI cache gap, accumulator replay spec, cancel during `prepare()`,
  cache-write tokens inside inputTokens, compaction trigger `auto`/`preTokens: 0`,
  `runtime-admission-mismatch` missing from `rpc-error-codes.types.ts`, hidden-tab single
  terminal slot (`chat-stream-delivery-coordinator.service.ts:233-236`), 8c inline card renders
  Claude buttons for a Codex request.
- **Network:** github.com HTTPS sometimes fails; retry once.
- **Process lessons:** CLI lanes never verify (no lock) — the team-leader runs every deciding
  verify. Lane reports arrive at the coordinator; forward them to the team-leader with
  SendMessage including the CLI resume id. Start a FRESH team-leader per resume with a short
  prompt (they reach 300k+ tokens). Team-leaders die with the coordinator process — note their
  state in batches.md often.

## Key files (worktree W = D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration)

- W/.ptah/specs/TASK_2026_714_c8a2/batches.md — source of truth; "Batch 8f" (uncommitted diff), "Run state (session 14)" ~line 918; P9 ~1808, P10 ~1830, Removal B 10e ~1862, P14 ~2003, P15 ~2025.
- W/.ptah/specs/TASK_2026_714_c8a2/decisions.md — P8 D1-D7 at the end.
- W/.ptah/specs/TASK_2026_714_c8a2/live-test-p8.md, code-logic-review-p8.md, code-style-review-p8.md — P8 findings (untracked).
- W/.ptah/specs/TASK_2026_714_c8a2/batch-8f-1-report.md, batch-8f-2-report.md, batch-8f-3-report.md — lane work (untracked).
- W/apps/ptah-electron/src/activation/bootstrap.ts — Codex binding at boot (B1, D1).
- W/apps/ptah-electron/src/di/codex-runtime-composition.ts — Electron Codex binding (D1, TC-18, style S2).
- W/apps/ptah-electron/src/ipc/ipc-bridge.ts — Codex approval reply routing (8b, style S3).
- W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts — adapter (split in 8f-2).
- W/libs/backend/rpc-handlers/src/lib/chat/codex-host/ — host ports, callbacks, settings record (8f-4).
- W/libs/settings-core (check path) `src/settings-core.spec.ts:834` — TC-18 guard.
- W/libs/backend/vscode-core/src/api-wrappers/host-attention-ingress.spec.ts — permission emission guard.

## Background work

None of this task (see orphaned verify pids above).

## Next steps (in order)

1. `cd W`; `git status -sb` (expect the uncommitted set above, HEAD = origin = b35d78386);
   `node scripts/verify.mjs --status`; clean up the two orphaned verifies if they are ours and dead.
2. Start a FRESH team-leader (Mode 2) with a short prompt (absolute paths) for batch 8f:
   verify + commit 8f-1, 8f-2, 8f-3 (checks listed above; resume their lanes for fixes), then
   run 8f-4, then 8f-5, then ONE phase gate:
   - `node scripts/verify.mjs --exec --task degradation-audit -- npx nx run degradation-audit:lint`
   - `node scripts/verify.mjs --exec --task di-lint -- npx nx run di-lint:lint`
   - `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
   - `npm run verify -- -t test -p @ptah-extension/vscode-core -- --testPathPatterns=host-attention-ingress`
   Commit the three review files + live-test-p8.md + 8f reports with the docs. STOP before any
   live run and when 8f is committed and green.
3. Push in the background; watch `gh pr checks 823`; fix real failures.
4. Tell the user, then rerun the live Electron test (procedure below; set an "ask" permission
   level first; scenarios a–f: send, approval Allow, approval Deny (prompt shows once), cancel,
   new session, clean shutdown with scope disposal). Write `live-test-p8b.md`.
5. One re-review scoped to the 8f commits (code-logic + code-style), fix round if needed.
6. Then P9 (gateway), P10 (lanes, Removal B at its end), live parity check (P14), P15 Removal A,
   per batches.md and D7.

## Verification rules (repeat to every lane)

- `npm run verify -- -p A,B` / `npm run verify -- -t test -p A` (extra Jest flags after a second
  `--`; confirm the "N projects" header). FIFO counting lock is machine-wide;
  `node scripts/verify.mjs --status`. Other heavy commands:
  `node scripts/verify.mjs --exec --task <name> -- <cmd>`. Never workspace-wide, never
  `nx run-many`, never positional `nx test A B`, never build/serve/dev/e2e/package except for an
  approved Electron live run.
- Known noise: `translation-proxy.sdk.integration.spec.ts` EPERM on Windows; agent-sdk lint 2
  errors in `session-query-executor.accounts.spec.ts:174,183`; auth-providers 3 lint errors;
  cli-agent-runtime 5-6; core 2; chat / rpc-handlers lazy-load static-import errors/warnings;
  di-lint `__fixtures__` ERROR lines are self-test output; degradation-audit self-test fixture
  violations; Electron E2E `config-change-permission-survival.spec.ts:204` and `state.spec.ts:41`
  flaked once each.
- Never npm ci / npm install in a worktree (node_modules is a junction).
- Lane deliverable paths MUST be absolute and declared at spawn. Lanes do not verify, commit or
  push. Check `git status` for files beyond the declared set.
- No `as unknown as`, `any`, `@ts-ignore` or `eslint-disable` added by this task.
- Commit in the foreground, explicit paths, `.commitlintrc.json` (scope `task-specs` for docs),
  subject <=72, body lines <=100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Push in the background. No PR merge, force push, history rewrite, branch deletion or worktree
  removal. Never commit log files. Do not edit `~/.ptah/settings.json` except the approved
  live-test backup/restore.

## Electron live-test procedure (run from W)

1. Back up `~/.ptah/settings.json` into a NEW `%TEMP%` folder.
2. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx build-dev ptah-electron`
3. `node scripts/copy-wasm.js dist/apps/ptah-electron`
4. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx copy-renderer-dev ptah-electron`
5. `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1 PTAH_DB_PATH=… PTAH_SESSIONS_DB_PATH=… node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9335 <ws>`
- Port 9335 only. Drive with Playwright `connectOverCDP`; reusable scripts in
  `%TEMP%/ptah-live-test-3/` and `%TEMP%/ptah-live-p8-20261026-183415/`. The legacy-path marker in
  the log is `[SessionLifecycle] Starting SDK query with options:` (must be 0 for Codex turns).
  Stop the app with `taskkill /T /F` on the worktree's root `electron.exe`. Restore settings.json
  and confirm with `cmp` (mandatory even on failure).
- Paid: Codex luna only (haiku only for a Claude regression check), tiny prompts, <=10 turns.
