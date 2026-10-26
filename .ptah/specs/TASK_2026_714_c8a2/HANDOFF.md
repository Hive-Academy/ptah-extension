# Session handoff — TASK_2026_714_c8a2 (session 15/16)

Written 2026-10-26. Replaces the session 14 handoff (in git history, commit 949c74b7e and earlier).
At handoff: NO subagent or CLI lane of this task is running. The worktree holds UNCOMMITTED,
FAILED-VERIFY work for batch 8g-2 (list below) — do not discard it.

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
- Identity store = option A (SessionMetadataStore). Removal B at the END of P10.
- P8 D7 (decisions.md): PR scope = P8, P9 gateway, P10 lanes + Removal B, live parity check (P14),
  P15 Removal A. P11–P13 and spikes S0–S2 go to a FOLLOW-UP PR. After Removal A, Codex main chat
  lacks native subagents/resume/rewind until that follow-up (user was told).
- Speed: per batch ONLY scoped `npm run verify -- -p <changed>`. Degradation audit, di-lint, the
  4-host typecheck and host-attention ONCE per phase. ADD `@ptah-extension/settings-core` to scoped
  verify when Electron DI or settings imports change.
- Live Electron test is approved: build-dev, `PTAH_CODEX_RUNTIME_DEV=1`, Codex luna only,
  <=10 paid turns per run, settings.json backup + `cmp` restore, set an "ask" permission level first.

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #823 https://github.com/Hive-Academy/ptah-extension/pull/823 | `feat/codex-runtime-integration` / `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration` | DRAFT, do not merge. origin = `c16226865` (CI GREEN: 20 pass, 3 skipped; `electron-e2e` shard 4 `state.spec.ts:41` flaked once, rerun passed). Local HEAD = `8606407bd` + this handoff commit, NOT pushed (pre-push hook not run on them). |
| #824, #826 | `fix/provider-switch-model-sync`, `fix/host-stored-model-validation` | MERGED. Worktrees + branches kept until the user authorizes cleanup. |

## Done this session

| Commit | Subject | Verify |
| --- | --- | --- |
| 020ec6fd8 | fix(codex-runtime): batch 8f-3 - executable pin without manifest json | codex-runtime pass |
| 1b46e5de7 | fix(electron,rpc-handlers): batch 8f-1 - guarded codex boot and dev root | 14/14 incl. settings-core TC-18 |
| 50c2634c7 | fix(agent-sdk): batch 8f-2 - codex adapter errors, split and barrel | pass (known accounts.spec lint) |
| 949c74b7e | docs(task-specs): record P8 reviews, live test and 8f-1..3 commits | docs |
| 42dc59cea | fix(agent-sdk,rpc-handlers,chat): batch 8f-4 - codex host ports fixes | 4/4 |
| e1f8138f6 | refactor(electron): batch 8f-5 - split codex binding, typed ipc port | 11/11 |
| 60a3dada2 | fix(rpc-handlers): mark the codex approval reply catch as reported | degradation audit pass |
| c16226865 | docs(task-specs): record batch 8f-4, 8f-5 and the P8 fix-round gate | 8f phase gate: audit, di-lint, 4-host typecheck, host-attention all pass. PUSHED. |
| df531dd52 | fix(rpc-handlers): batch 8g-1 - codex option policy, approval settle | rpc-handlers 3/3 (NOT pushed) |
| 8606407bd | docs(task-specs): record P8 fix round 2 (8g) plan and wrap-up state | docs (NOT pushed) |

Also done: two orphaned queued verifies of this worktree (dead root process) were killed.

Results that drive round 8g (all committed in the task folder):
- `live-test-p8b.md` — FAIL at scenario a, 0 paid turns, settings.json restored (`cmp` identical).
  D1, D2, D3 confirmed fixed live. NEW blocker **D5**: Codex `profile()` rejected start options
  that every chat start sends. Minor: "Orchestrator" chip shows green "done" after a failed start.
  D4 still present (separate PR). Evidence: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8b-20261026-203740\`.
- `code-logic-review-p8f.md` — NEEDS_REVISION 7/10: S-N0 serious (pre-existing, see below),
  moderates M-N1..M-N7, partials S3/M3/M4/D3.
- `code-style-review-p8f.md` — APPROVED 8/10, 5 minors.

## In progress (batch 8g, plan in batches.md line ~2032 "Batch 8g")

1. **8g-1b — D5 still OPEN (blocker).** df531dd52 strips host-only options (`mcpServerRunning`,
   `workflowsDisabled`, `includePartialMessages`, empty `mcpServersOverride`; logs
   `ptah-mcp-not-attached`) and throws `CodexChatOptionError` naming other keys. But the renderer
   ALWAYS sends `ptahUiFence: true` (`libs/frontend/chat/src/lib/services/message-sender.service.ts:476`)
   and the policy still REJECTS it, so the default Electron Codex start still fails.
   Decision (coordinator + team-leader): when `ptahUiFence` is true and the tool profile is
   `coding`, put `PTAH_UI_HINT` into the native `developerPrompt` (same gate as
   `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1821-1824`); needs a one-line
   `PTAH_UI_HINT` export in the agent-sdk barrel. If no native carrier works: accept and ignore
   with a debug log. Frontend stays unchanged. The real-config spec in
   `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts` MUST include the
   default message-sender options (with `ptahUiFence: true`). Resume lane
   `01a17953-dc41-7ad2-956a-a4c785ba34bd`.
   Verify: `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk`
2. **8g-2 — written, verify FAILED, UNCOMMITTED.** M-N1 (failed inspection not cached), M-N2
   (pin hash check before `--version`), M-N3 (shutdown budget stages inactive writes), style
   M2/M4/M5. Files (all in W):
   `apps/ptah-electron/src/activation/shutdown.ts`, `shutdown.spec.ts`,
   `apps/ptah-electron/src/di/codex-runtime-composition.ts`, `codex-runtime-composition.spec.ts`,
   `codex-session-binding.ts`, `codex-binding.types.ts` (NEW, untracked),
   `libs/backend/codex-runtime/src/lib/codex-executable-pin-data.ts` (comment only).
   Failure: `ptah-electron:test` suite `src/activation/shutdown.spec.ts` cannot load —
   `SURFACE_STATE_SERVICE` undefined at `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:127`
   via `shutdown.spec.ts:14` -> `codex-session-binding.ts:16` (runtime import of the rpc-handlers
   barrel). Fix: type-only import in `codex-session-binding.ts` (preferred) or a module mock in the
   spec. 1273 other tests pass. Resume lane `01a17954-2161-76c0-876a-f0d93a46f38f`.
   Verify: `npm run verify -- -p ptah-electron,@ptah-extension/codex-runtime,@ptah-extension/settings-core`
3. **8g-3 PENDING** — compaction single signal (native data, no `auto`/`preTokens 0`), unused
   barrel exports `CodexChatAdapter`/`registerCodexChatServices`, typed adapter error guard.
4. **8g-4 PENDING** — typed Codex RPC codes, cancelled is not an error (Stop during open must not
   show "could not start"), legacy settings style (hand-copied effort list).
5. **8g-5 PENDING** — frontend cancelled start and "Orchestrator" chip state after a failed start.
6. **8g phase gate** — not run (commands below).

Details, owners and file sets for 8g-3..8g-5: batches.md lines ~2127-2160; key-policy table:
"Plan validation (8g)" ~2045; state: "Run state (session 16)".

## Open problems and decisions

- **D5** — see 8g-1b. Nothing else blocks the live run once D5 and 8g-2 are fixed.
- **S-N0 (hidden-tab terminal overwrite, `chat-stream-delivery-coordinator.service.ts:232-235`)**
  — pre-existing on `main` (no diff against main) -> SEPARATE small PR, not this branch.
- **LIVE D4** (from #824) — save to "This workspace" also writes global
  `provider.openai-codex.mainAgent.modelTier.*` -> SEPARATE small PR.
- **Deferred with reasons (batches.md "Batch 8g deferred" and "Batch 8f deferred"):** M-N7 / M3
  remainder (approvals lost on renderer reload; no delivery receipt or renderer-ready hook in Codex
  ports), M2 metadata rollback, M6 `surfaceMode`, tabId fallback, ipc-bridge `console.warn`, global
  binding registry, plus the older list (live session stats, `review/start`, etc.).
- **Process lessons:** CLI lanes never verify (no lock). Lane reports arrive at the coordinator —
  forward them to the team-leader with SendMessage + the CLI resume id. A coordinator decision
  sent to the team-leader may reach a lane too late: check the lane's final diff for it (this is
  how D5 stayed open). Start a FRESH team-leader per resume with a short prompt. Lanes call
  `ptah_get_diagnostics`, which starts a TS check outside the verify lock (returns unavailable).
- **Network:** github.com HTTPS sometimes fails; retry once.

## Key files (W = D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration)

- W/.ptah/specs/TASK_2026_714_c8a2/batches.md — source of truth ("Batch 8g" ~2032; P9, P10,
  Removal B 10e, P14, P15 sections further down).
- W/.ptah/specs/TASK_2026_714_c8a2/decisions.md — P8 D1-D7.
- W/.ptah/specs/TASK_2026_714_c8a2/live-test-p8b.md, code-logic-review-p8f.md,
  code-style-review-p8f.md, batch-8g-1-report.md, batch-8g-2-report.md.
- W/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts and
  codex-chat-profile-options.ts — D5 option policy.
- W/libs/frontend/chat/src/lib/services/message-sender.service.ts:476 — `ptahUiFence: true`.
- W/apps/ptah-electron/src/di/codex-session-binding.ts:16 — the barrel import that breaks shutdown.spec.
- W/apps/ptah-electron/src/di/codex-runtime-composition.ts, activation/bootstrap.ts, shutdown.ts.

## Next steps (in order)

1. `cd W`; `git status -sb` (expect the 8g-2 files above uncommitted; HEAD = handoff commit,
   2-3 commits ahead of origin `c16226865`); `node scripts/verify.mjs --status`.
2. Start a FRESH team-leader (Mode 2) with a short prompt (absolute paths):
   a. 8g-1b: resume lane `01a17953-dc41-7ad2-956a-a4c785ba34bd` with the D5 decision above;
      verify `-p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk`; commit.
   b. 8g-2: fix shutdown.spec load (resume lane `01a17954-2161-76c0-876a-f0d93a46f38f` or a
      type-only import); verify `-p ptah-electron,@ptah-extension/codex-runtime,@ptah-extension/settings-core`; commit.
   c. 8g-3, 8g-4, 8g-5 per batches.md (add `@ptah-extension/chat` for frontend changes).
   d. ONE phase gate:
      - `node scripts/verify.mjs --exec --task degradation-audit -- npx nx run degradation-audit:lint`
      - `node scripts/verify.mjs --exec --task di-lint -- npx nx run di-lint:lint`
      - `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
      - `npm run verify -- -t test -p @ptah-extension/vscode-core -- --testPathPatterns=host-attention-ingress`
   STOP before any live run.
3. Push in the background; watch `gh pr checks 823`; fix real failures (`state.spec.ts:41` and
   `config-change-permission-survival.spec.ts:204` are known flakes: rerun once).
4. Rerun the live Electron test as `live-test-p8c.md` (procedure below), scenarios a–f: send,
   approval Allow, approval Deny (prompt once), cancel, new session, clean shutdown with Codex
   scope disposal. Legacy marker count must be 0.
5. If live passes: one re-review scoped to the 8g commits (code-logic + code-style). Then P9
   (gateway), P10 (lanes, Removal B at its end), P14 live parity check, P15 Removal A — per
   batches.md and D7.
6. Separate small PRs from `main` (own worktrees): S-N0 and LIVE D4.

## Verification rules (repeat to every lane)

- `npm run verify -- -p A,B` / `npm run verify -- -t test -p A` (extra Jest flags after a second
  `--`; confirm the "N projects" header). FIFO counting lock is machine-wide;
  `node scripts/verify.mjs --status`. Other heavy commands:
  `node scripts/verify.mjs --exec --task <name> -- <cmd>`. Never workspace-wide, never
  `nx run-many`, never positional `nx test A B`, never build/serve/dev/e2e/package except for the
  approved Electron live run.
- Known noise: `translation-proxy.sdk.integration.spec.ts` EPERM on Windows; agent-sdk lint 2
  errors in `session-query-executor.accounts.spec.ts:174,183`; auth-providers 3 lint errors;
  cli-agent-runtime 5-6; core 2; chat / rpc-handlers lazy-load static-import errors/warnings;
  di-lint `__fixtures__` ERROR lines are self-test output; degradation-audit self-test fixture
  violations.
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
  `%TEMP%/ptah-live-p8b-20261026-203740/` (latest), `%TEMP%/ptah-live-p8-20261026-183415/`.
  Before the first turn: main agent OpenAI Codex / GPT-5.6-Luna, approval mode "Manual" with
  "Disable Autopilot". Legacy-path marker `[SessionLifecycle] Starting SDK query with options:`
  must be 0 for Codex turns. Stop the app with `taskkill /T /F` on the worktree's root
  `electron.exe` if it is still running. Restore settings.json and confirm with `cmp`
  (mandatory even on failure).
- Paid: Codex luna only (haiku only for a Claude regression check), tiny prompts, <=10 turns.
