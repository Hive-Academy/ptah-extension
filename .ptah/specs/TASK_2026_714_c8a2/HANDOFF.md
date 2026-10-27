# Session handoff — TASK_2026_714_c8a2 (session 17)

Written 2026-10-27. Replaces the session 15/16 handoff (in git history, commit 9b0b89b5b).
At handoff: NO subagent, team-leader or CLI lane of this task is running. The worktree is clean.
Local HEAD = the commit that adds this file, on top of `3e7188d05`; origin = `756814876`.

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. Then DELETE
legacy path B (`@openai/codex-sdk`, CLI lanes) and path A (Claude Agent SDK + Codex translation
proxy for Codex main chat). Claude behavior unchanged. Electron first. No runtime-selector UI.
Production stays behind the parity gate until parity is proven.

**User decisions (all confirmed by the user):**
- PR #823 is NOT merged by us. It is ready only when main chat, gateways and lanes run on the App
  Server AND paths A and B are removed. Defects that existed before this task go out as SEPARATE
  small PRs that the user merges first; then `main` is MERGED into the runtime branch (no rebase,
  no force push).
- Native App Server features wherever they exist; build only where they do not.
- Identity store = option A (SessionMetadataStore). Removal B at the END of P10.
- P8 D7 (decisions.md): PR scope = P8, P9 gateway, P10 lanes + Removal B, live parity check (P14),
  P15 Removal A. P11–P13 and spikes S0–S2 go to a FOLLOW-UP PR.
- Speed: per batch ONLY scoped `npm run verify -- -p <changed>`. Degradation audit, di-lint, the
  4-host typecheck and host-attention ONCE per phase. Add `@ptah-extension/settings-core` for
  Electron DI/settings changes, `@ptah-extension/chat` for frontend, `ptah-electron` when
  `CodexChatAdapterPorts` changes.
- Live Electron test is approved: build-dev, `PTAH_CODEX_RUNTIME_DEV=1`, Codex luna only,
  <=10 paid turns per run, settings.json backup + `cmp` restore, approval mode "Manual" first.
- **NEW (session 17) D6 policy:** host-assembled ambient inputs (`mcpServersOverride` with
  entries, `thinking`, `outputStyleName`) are stripped; the start proceeds and the chat shows ONE
  non-error notice per start/resume naming the MCP servers not attached / the style not applied
  (names only). Parity row 39 is revised: "the feature fails visibly, not the turn". Native MCP
  mapping is NOT manageable now (no secret resolution at the runtime boundary, C10 unproved) ->
  P14.
- **NEW (session 17):** another worktree's Ptah Dev app holding the single-instance lock is NOT
  killed without asking the user. User answer for p8d: wait until that session releases it.
  (PID 35288 from `claude-named-accounts` was killed once with user approval.)

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #823 https://github.com/Hive-Academy/ptah-extension/pull/823 | `feat/codex-runtime-integration` / `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration` | DRAFT, do not merge. origin = `756814876`. CI GREEN at `0008f7f3d` (19 pass, 4 skipped). **NO CI ran for `756814876`: the PR is CONFLICTING with main** (`mergeStateStatus DIRTY`, main 53 commits ahead). Local `3e7188d05` + handoff commit NOT pushed. No reviews (REVIEW_REQUIRED). |
| #824, #826 | `fix/provider-switch-model-sync`, `fix/host-stored-model-validation` | MERGED. Worktrees + branches kept until the user authorizes cleanup. |

## Done this session

| Commit | Subject | Verify |
| --- | --- | --- |
| 3362b2ad5 | fix(electron,codex-runtime): batch 8g-2 - binary inspection, shutdown | ptah-electron, codex-runtime, settings-core pass |
| 1194ed505 | fix(rpc-handlers,agent-sdk): batch 8g-1b - map ptahUiFence natively | rpc-handlers, agent-sdk pass |
| 2f9a98bd9 | fix(agent-sdk,rpc-handlers): batch 8g-3 - one native compaction signal | pass + ptah-electron typecheck |
| 82901d5c4 | fix(rpc-handlers,shared,agent-sdk): batch 8g-4 - typed codex rpc codes | shared, rpc-handlers, agent-sdk, chat pass |
| aa8dd6c60 | fix(chat): batch 8g-5 - quiet cancelled codex start, one compact error | chat pass |
| 0008f7f3d | docs(task-specs): record batch 8g-1b..8g-5 commits and the P8 gate | 8g phase gate all pass. PUSHED, CI green |
| 49345a199 | docs(task-specs): record live test p8c, D6 open blocker | docs |
| c02d25f2f | fix(rpc-handlers): batch 8h-2 - log the real chat rpc outcome | see 8h |
| 18ef3fef8 | fix(rpc-handlers,agent-sdk): batch 8h-1,3,4 - codex ambient inputs | rpc-handlers (186 suites / 4814 tests), agent-sdk, ptah-electron pass |
| 756814876 | docs(task-specs): record batch 8h, parity row 39 revision, P8 gate | 8h phase gate all pass (audit, di-lint, 4-host typecheck, host-attention). PUSHED |
| 3e7188d05 | docs(task-specs): record live test p8d, D6 fixed, D7 open blocker | docs, NOT pushed |

Known lint noise only: agent-sdk `session-query-executor.accounts.spec.ts:174,183`; chat lazy-load
imports and `attention-context.util.ts` (unchanged from main).

Live tests (reports committed in this folder):
- `live-test-p8c.md` (HEAD 0008f7f3d): FAIL, blocker D6 (`mcpServersOverride` rejected). 0 paid
  turns, settings restored (`cmp` identical). D5, single error UI and Orchestrator chip fixed.
- `live-test-p8d.md` (HEAD 756814876): FAIL, blocker **D7**. D6 and M1 confirmed fixed live
  (0 `CodexChatOptionError`, names-only `codex-user-mcp-not-attached` log, real outcome logged).
  0 paid turns, settings restored (`cmp` identical). Evidence:
  `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8d-20261027-214138\`.

## In progress

Nothing is partly written. The next work item is fix round **8i** for D7 (not planned yet in
batches.md).

## Open problems and decisions

- **D7 (blocker for every Codex chat start):** `libs/backend/codex-runtime/src/lib/codex-runtime.ts:115-122`
  replaces any `RuntimeContext.open` failure with `Error('Codex context could not be opened')`,
  no cause, no log. The `codex app-server` process DID start (its MCP client connected to Ptah's
  MCP server), so the failure is in `thread/start`: a rejected request, a reply that failed the
  protocol check (`codex-app-server-process.ts:211-219`, `:269-271`, `:308-327`), or
  `store.persist`. Codex stderr is discarded (`codex-app-server-process.ts:170`). Likely trigger:
  the user's `~/.codex/config.toml` defines MCP servers `node_repl` and `ptah` that Codex loads at
  `thread/start`. First fix: keep and log the real cause (no payloads, no secrets) and keep a
  bounded stderr tail at debug; then ONE start attempt shows the cause without a paid turn.
- **Decision needed (ask the user once D7's cause is known):** native chat honors or suppresses
  MCP servers from the user's own `~/.codex/config.toml`. Ptah logs "Ptah MCP is not attached",
  but Codex attaches Ptah MCP anyway from that config.
- **Merge conflict with main:** one file conflicts,
  `apps/ptah-electron/src/di/surface-composition.spec.ts` (auto-merged: bootstrap.ts, shutdown.ts,
  container.smoke.spec.ts, expected-resolvable.ts, ipc-bridge.ts, rpc-surface.spec.ts,
  rpc-handlers/shared index.ts, message-constants.ts, payload-map.ts). Per the user decision:
  `git merge origin/main` (merge commit, no rebase), resolve, scoped verify of the touched
  projects + the 4 DI guard specs, then push so CI runs again.
- **Deferred (batches.md "Batch 8g deferred", "Batch 8h deferred"):** native user-MCP mapping
  (P14), output style by name on Codex (P14), apply changed model/effort/permissionLevel on an
  active resume (P14), MCP Apps page `apps` profile on Codex (explicit error now), M2 "api error"
  label for local failures (needs a new terminal reason in shared + chat + chat-ui), and the older
  lists (M-N7/M3 approvals on renderer reload, M2 metadata rollback, M6 `surfaceMode`, etc.).
- **For the P8 re-review (minor):** publish catch still logs "Model substitution notice failed"
  for every runtime notice; in `codex-chat-adapter.ts` the class doc comment now sits above the
  `TrackedSession` alias; on a cancelled start `markLoaded`/`markTabIdle` run twice (harmless).
- **Separate small PRs from `main` (own worktrees), not this branch:** S-N0 (hidden-tab terminal
  overwrite, `chat-stream-delivery-coordinator.service.ts:232-235`) and LIVE D4 (save to "This
  workspace" also writes global `provider.openai-codex.mainAgent.modelTier.*`; seen again in p8c
  and p8d).
- **Process lessons (session 17):**
  - `ptah_agent_message` to a Codex lane in mid-turn is only QUEUED, and it was LOST twice when
    the lane ended. Use a resume (`ptah_agent_spawn` with `resume_session_id`) from the
    team-leader instead. Check every lane's final diff for coordinator decisions.
  - A team-leader resume can run CONCURRENTLY with the original lane's queued turn on the same
    files: wait for both completion signals before verify.
  - Lanes still call `ptah_get_diagnostics` despite the rule (it runs TypeScript outside the lock);
    say "do NOT call ptah_get_diagnostics" explicitly in every lane prompt.
  - Only one Ptah Dev Electron can run per machine (`apps/ptah-electron/src/main.ts:61-66`).
    Check for another root `electron.exe` before a live run.
  - github.com HTTPS sometimes fails; the push retry worked.

## Key files (W = D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration)

- W/.ptah/specs/TASK_2026_714_c8a2/batches.md — source of truth ("Batch 8g", "Batch 8h" with the
  ambient-key audit table, deferred lists, "Run state (session 17)"; P9, P10, Removal B, P14, P15
  further down).
- W/.ptah/specs/TASK_2026_714_c8a2/decisions.md — P8 D1-D7. parity-inventory.md — row 39 revised.
- W/.ptah/specs/TASK_2026_714_c8a2/live-test-p8d.md — D7 evidence and the procedure used.
- W/libs/backend/codex-runtime/src/lib/codex-runtime.ts:89 (refuses profiles with mcpServers),
  :115-122 (D7 swallowed cause).
- W/libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:170 (stderr dropped),
  :211-219, :269-271, :308-327 (protocol checks).
- W/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.ts — option
  policy (supported / stripped / rejected).
- W/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts — profile build,
  PTAH_UI_HINT, `checkOptions`.
- W/libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts —
  `publishRuntimeNotices` (the visible notice).
- W/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts — adapter (compaction,
  cancel logging, active resume).
- W/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts — real-config spec
  (renderer payload, Smithery + OAuth stubs).
- W/apps/ptah-electron/src/di/surface-composition.spec.ts — the merge conflict.

## Background work

None. All subagents and CLI lanes of this session finished and reported. Nothing waits on a
permission.

## Next steps (in order)

1. `cd W`; `git status -sb` (expect clean, 2 commits ahead of origin `756814876`);
   `node scripts/verify.mjs --status`.
2. Merge main (user decision: merge, no rebase): `git fetch origin main`; `git merge origin/main`;
   resolve `apps/ptah-electron/src/di/surface-composition.spec.ts`; commit the merge in the
   foreground. Verify:
   `npm run verify -- -p ptah-electron,ptah-extension-vscode,@ptah-extension/rpc-handlers,@ptah-extension/shared,@ptah-extension/settings-core`
   (covers the DI guard specs `container.smoke.spec.ts`, `expected-resolvable.ts`,
   `rpc-surface.spec.ts`, `surface-composition.spec.ts`).
3. Push in the background; watch `gh pr checks 823` (known flakes `state.spec.ts:41`,
   `config-change-permission-survival.spec.ts:204`: rerun once).
4. Fix round 8i via a FRESH team-leader (short prompt, absolute paths): D7 step 1 = preserve and
   log the real `RuntimeContext.open` / `thread/start` failure cause (no payloads or secrets) and a
   bounded Codex stderr tail at debug in `codex-runtime.ts` / `codex-app-server-process.ts`, with
   specs. Verify `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/agent-sdk,ptah-electron`.
   Phase gate once:
   - `node scripts/verify.mjs --exec --task degradation-audit -- npx nx run degradation-audit:lint`
   - `node scripts/verify.mjs --exec --task di-lint -- npx nx run di-lint:lint`
   - `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
   - `npm run verify -- -t test -p @ptah-extension/vscode-core -- --testPathPatterns=host-attention-ingress`
5. Push; then live test p8e (procedure below, reuse `live-test-p8d.md`): ONE start attempt to read
   the real D7 cause. Then fix the cause (ask the user the `~/.codex/config.toml` MCP question if it
   is the trigger), and rerun the full scenarios a, a2, b, c, d, `/compact`, e, f.
6. If live passes: P8 re-review of the 8g + 8h + 8i commits (code-logic + code-style, a CLAUDE
   reviewer because Codex lanes implemented). Then P9 (gateway), P10 (lanes, Removal B at its end),
   P14 live parity check, P15 Removal A — per batches.md and D7.
7. Separate small PRs from `main`: S-N0 and LIVE D4.

## Verification rules (repeat to every lane)

- `npm run verify -- -p A,B` / `npm run verify -- -t test -p A` (extra Jest flags after a second
  `--`; confirm the "N projects" header). FIFO counting lock is machine-wide;
  `node scripts/verify.mjs --status`. Other heavy commands:
  `node scripts/verify.mjs --exec --task <name> -- <cmd>`. Never workspace-wide, never
  `nx run-many`, never positional `nx test A B`, never build/serve/dev/e2e/package except for the
  approved Electron live run.
- Lanes: deliverable paths absolute and declared at spawn; never verify, commit or push; never
  call `ptah_get_diagnostics`. Check `git status` for files beyond the declared set.
- Never npm ci / npm install in a worktree (node_modules is a junction).
- No `as unknown as`, `any`, `@ts-ignore` or `eslint-disable` added by this task.
- Commit in the foreground, explicit paths, `.commitlintrc.json` (scope `task-specs` for docs),
  subject <=72, body lines <=100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Push in the background. No PR merge, force push, history rewrite, branch deletion or worktree
  removal. Do not edit `~/.ptah/settings.json` except the approved live-test backup/restore.

## Electron live-test procedure (run from W)

1. Check that no other root Ptah Dev `electron.exe` runs (single-instance lock). If one does, ask
   the user; do not kill it.
2. Back up `~/.ptah/settings.json` into a NEW `%TEMP%/ptah-live-p8e-<timestamp>/` folder.
3. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx build-dev ptah-electron`
4. `node scripts/copy-wasm.js dist/apps/ptah-electron`
5. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx copy-renderer-dev ptah-electron`
6. `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1 PTAH_DB_PATH=<folder>/ptah.db PTAH_SESSIONS_DB_PATH=<folder>/sessions.db node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9335 <folder>/ws`
- Port 9335 only. Drive with Playwright `connectOverCDP`; reusable scripts in
  `%TEMP%/ptah-live-p8d-20261027-214138/` and `%TEMP%/ptah-live-p8b-20261026-203740/`.
  Before the first turn: main agent OpenAI Codex / GPT-5.6-Luna ("This workspace"), approval mode
  "Manual" via "Disable Autopilot". Legacy marker `[SessionLifecycle] Starting SDK query with options:`
  must be 0. Stop the app with `taskkill /T /F` on THIS worktree's root `electron.exe` only.
  Restore settings.json and confirm with `cmp` (mandatory even on failure).
- Paid: Codex luna only (haiku only for a Claude regression check), tiny prompts, <=10 turns.
