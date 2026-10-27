# Session handoff — TASK_2026_714_c8a2 (session 18)

Written 2026-10-28. Replaces the session 17 handoff (in git history, commit `9b5f4c86c^` area;
see `git log -- .ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`).
At handoff: NO subagent, team-leader or CLI lane of this task is running. The verify lock is free.

W = `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. Then DELETE
legacy path B (`@openai/codex-sdk`, CLI lanes) and path A (Claude Agent SDK + Codex translation
proxy for Codex main chat). Claude behavior unchanged. Electron first. No runtime-selector UI.
Native chat must produce EXACTLY the same UI contracts as Claude (`FlatStreamEventUnion`,
`turn_state`, `PermissionRequest`, session RPCs); never special-case the frontend for Codex.

## User decisions (all confirmed by the user; full table in decisions.md)

- PR #823 is NOT merged by us. Pre-existing defects go out as SEPARATE small PRs from `main`;
  `main` is MERGED into the branch (merge commit, no rebase, no force push).
- Native App Server features first; build only where they do not exist.
- Identity store = option A (SessionMetadataStore). Removal B at the END of P10.
- PR #823 scope (P8 D7, re-confirmed as D9 this session): P8, P9 gateways, P10 lanes + Removal B,
  P14 live parity check, P15 Removal A. P11 (subagents), P12 (history), P13 (checkpoints) go to
  the FOLLOW-UP PR. User accepted that Codex main chat loses those natively until the follow-up.
- **D8 (session 18):** native Codex chat must reach full parity with Claude main chat: skills,
  MCP servers (Ptah MCP AND the user's MCP servers), system prompts. Native chat HONORS MCP.
  Do NOT strip, revert or comment out MCP to bypass a problem. The 8h/D6 strip-with-notice is
  TEMPORARY until native MCP attach (round 8l).
- **NEW (session 18, record as a decision row in round 8l):** the Codex harness sync (writes
  `~/.codex/config.toml` `# ptah:begin` MCP blocks + the `ptah` entry via `ptah-mcp-slots.ts`,
  `{ws}/.agents/skills`, `{ws}/.codex/agents/*.toml`) is REMOVED COMPLETELY in the FOLLOW-UP PR,
  with a one-time cleanup of Ptah-fenced blocks. Ptah reads MCP/skills/agents from its OWN store
  and passes them natively per thread. In PR #823 (8l): Ptah's own synced `ptah` entry is
  overridden/disabled per Ptah thread so the native session-scoped Ptah MCP URL always wins;
  the user's hand-written entries (e.g. `node_repl`) are not touched.
- D10: the dev-only probe `scripts/codex-start-probe.ts` is approved (coordinator runs it).
- D9 (history after reload) is REQUIRED before Removal A (P15).
- Live Electron test is approved: build-dev, `PTAH_CODEX_RUNTIME_DEV=1`, Codex luna only,
  <=10 paid turns per run, settings.json backup + `cmp` restore, approval mode "Manual" first.
- Another worktree's Ptah Dev app holding the single-instance lock is NOT killed without asking.

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #823 https://github.com/Hive-Academy/ptah-extension/pull/823 | `feat/codex-runtime-integration` / W | DRAFT, do not merge. Main merged this session (42170f631). CI GREEN at `88c50b841` (19 pass, 4 skipped). Commits up to this handoff commit pushed at handoff (check `git status -sb`). No reviews (REVIEW_REQUIRED). |
| #824, #826 | `fix/provider-switch-model-sync`, `fix/host-stored-model-validation` | MERGED. Worktrees + branches kept until the user authorizes cleanup. |

## Done this session (session 18)

| Commit | Subject / result |
| --- | --- |
| 42170f631 | Merge origin/main (conflict in apps/ptah-electron/src/di/surface-composition.spec.ts: kept main's 3rd `IpcBridge` arg `[]`) |
| 2fec60b8b | fix(electron): pass trusted documents in the codex permission spec (merge fallout). CI green |
| c2a06f834 | fix(codex-runtime): keep and log the cause of a failed context open (8i-1) |
| 092095c4b | feat(scripts,codex-runtime): add a local codex app-server start probe (8i-2) |
| 9b5f4c86c | docs(task-specs): record batch 8i, D7 probe and parity decisions (D8-D10) |
| eccc2182f | fix(codex-runtime): tolerate additive app-server shapes and early events (8j) |
| 88c50b841 | docs(task-specs): record batch 8j, D7 root cause and fix decisions. CI green |
| e91e967c9 | docs(task-specs): record live test p8e, D7 fixed, D8-D12 open |
| 65a5537e6 | fix(agent-sdk,electron): end native Codex turns with turn_state (8k-1: D8, D12 abort) |
| 095e4246e | feat(agent-sdk,codex-runtime): present native tools as Ptah tools (8k-2) |
| dac92cedb | fix(agent-sdk,codex-runtime): report native model and context in stats (8k-4) |
| 785de99ef | fix(agent-sdk,rpc-handlers): resume native Codex sessions, Ptah tool names (8k-3 part: D10). Subject is 74 chars (hook accepted; no rewrite) |
| 20ce5854f | docs(task-specs): record batch 8k, D8/D10/D12 fixed, D11 host pending |

**D7 root cause (fixed in 8j):** strict `z.strictObject` schemas rejected 7 additive fields in the
real `thread/start` result, and `remoteControl/status/changed` arriving before `ready` was fatal.
User MCP servers were NOT the cause. Server-sent shapes now drop unknown keys (required fields
still strict); client-sent params stay strict; unknown notifications are ignored (debug log once
per method, cap 64); early notifications are buffered (cap 64). Probe on eccc2182f: both
variants OK (`initialize + thread/start`).

**Live test p8e** (live-test-p8e.md, first native turns in the UI): all 5 opens OK, Codex replies.
D8 turn never ended (fixed 8k-1), D11 no approval buttons (bridge part committed, host part
uncommitted), D10 continue starts new thread (fixed 8k-3), D12 stop = runtime-failed (abort fixed
8k-1; notice release is in the uncommitted host part), D9 history after reload (deferred, required
before P15). Codex attached Ptah MCP only through `~/.codex/config.toml`. 5 paid turns; cmp OK.

## In progress (UNCOMMITTED in W)

D11 host side, written by lane 8k-3 (Codex session `01a17f67-41d3-7741-98c6-b3d0180d50c6`):
- `W/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts` — UUID id per
  prompt mapped to the Codex request identity; that id for cancel, auto-resolve and notice release;
  omit `tabId` when it would be the session id; `timeoutAt` = real deadline; uses
  `presentCodexApproval`. Production code compiles (phase gate passed with it in the tree).
- `W/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts` — DOES NOT
  COMPILE: `:360`, `:457`, `:458`, `:572` pass `['deny','allowOnce']` where the full 4-item choices
  list is required; `:556` the cancel `reason` from the test table is typed `string`, not the
  allowed literals. Test typing only.

## Open problems and deferred items (all recorded in batches.md "Batch 8k")

- 8k-5 not run: end-to-end specs (native turn vs a Claude fixture turn, event by event; approval
  through the real renderer parser `permission.parsers.ts` with `toolUseId` == tool_start id;
  stop during approval -> abort + notice cleared).
- Header Tokens/Cost stay "—": `SessionStatsOwnerService.replaceRun` needs cumulative per-run
  totals; Codex sends per-turn deltas. Needs new contracts. Cost has no Codex pricing.
- `fileChange` edits keep the raw name (Edit card needs old/new strings). Only single-file add ->
  `Write`.
- Streaming gaps: `item/reasoning/*Delta` and `item/commandExecution|fileChange/outputDelta` are
  unmodeled and ignored -> thinking and tool output appear only on completion. Map them natively.
- Recorded-stream fixtures (sanitized real App Server notifications per scenario) run through
  translator + chat-events in CI; count ignored notification methods in the parity report.
- `session-rpc.handlers.ts:125` local copy of the thread-record schema (parser not exported).
- Probe: a normal close logs debug "Codex process failure / process exited" (wrong wording).
- Unknown server REQUEST with an extra top-level key still kills the process instead of a
  "Method not found" reply (pre-8j behavior).
- Known pre-existing lint noise from main: agent-sdk
  `session-query-executor.accounts.spec.ts:174,183` (CI is green with it). Do not fix in this PR.
- Process defect: Codex `backend-developer` lanes call `ptah_get_diagnostics` despite the ban
  (role preamble requires it; task prompt cannot override). Twice in 8i/8j. Needs a role change.
- Process: lane completion signals arrive at the COORDINATOR, not the team-leader. Relay each one
  with SendMessage to the team-leader (files + session id), or the team-leader waits.
- Codex lane weekly limit was at 92-95% at handoff; the team-leader used GLM lanes for 8k-2/8k-4.
- Separate small PRs from `main` (own worktrees), not this branch: S-N0 (hidden-tab terminal
  overwrite, `chat-stream-delivery-coordinator.service.ts:232-235`) and LIVE D4 (save to "This
  workspace" also writes global `provider.openai-codex.mainAgent.modelTier.*`).

## Key files

- W/.ptah/specs/TASK_2026_714_c8a2/batches.md — source of truth (Batch 8i, 8j, 8k sections,
  deferred lists; P9, P10, Removal B, P14, P15 further down). decisions.md (P8 D1-D12).
- W/.ptah/specs/TASK_2026_714_c8a2/live-test-p8e.md — latest live evidence and procedure.
- W/scripts/codex-start-probe.ts — free start probe (no Electron, no turn).
- W/libs/backend/codex-runtime/src/lib/: codex-runtime.ts (open; `:89` still REFUSES profiles
  with `mcpServers` — round 8l changes this), codex-app-server-process.ts, codex-protocol-*.ts,
  codex-event-translator.ts, codex-approval-bridge.ts, codex-stderr-tail.ts.
- W/libs/backend/agent-sdk/src/lib/codex-app-server/: codex-chat-adapter.ts,
  codex-chat-turn-stream.ts, codex-chat-events.ts, codex-chat-approval-sink.ts,
  codex-tool-presentation.ts.
- W/libs/backend/rpc-handlers/src/lib/chat/codex-host/: codex-chat-host-ports.ts (profile build,
  approvals, "Ptah MCP is not attached" log at ~:157), codex-chat-profile-options.ts (strip list).
- W/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts — native `session:validate`.
- MCP sync to remove in the follow-up PR: W/libs/backend/harness-sync/src/lib/targets/mcp/
  codex-toml-mcp-facet.ts, targets/rival-targets.ts (`createCodexTarget`),
  W/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/ptah-mcp-slots.ts (Codex rows).
- Native Ptah MCP URL builder already used by lanes: W/libs/backend/cli-agent-runtime/src/lib/
  cli-agents/cli-adapters/ptah-mcp-url.ts (`ptahMcpServerUrl`, session/workspace scoped, no secret)
  and codex/codex-lane-config.builder.ts:147-156.

## Next steps (in order)

1. `cd W`; `git status -sb` (expect only the 2 uncommitted host-ports files);
   `node scripts/verify.mjs --status`; `gh pr checks 823` for the pushed head.
2. Finish D11 host side: resume lane `01a17f67-41d3-7741-98c6-b3d0180d50c6` (ptah_agent_spawn with
   resume_session_id; Codex may be near its weekly limit — else a fresh lane with the same scope)
   to fix the 5 spec typing lines, OR a fresh team-leader. Then
   `npm run verify -- -t test -p @ptah-extension/rpc-handlers` and
   `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron`; commit both files.
3. 8k-5 end-to-end specs (see Open problems). Verify the touched projects.
4. Round 8l, native MCP (FRESH team-leader): Ptah MCP as an http `profile.mcpServers` entry with
   the session/workspace URL from `ptahMcpServerUrl`; relax `codex-runtime.ts:89` for servers
   without secret references; pass servers through the native App Server config at thread/start
   (`mcp_servers.ptah.url`, `tool_timeout_sec`), overriding the synced `ptah` entry; remove the
   "Ptah MCP is not attached" log. Then the user's MCP servers from `mcpServersOverride` (stdio +
   http/sse; secrets only to the process, never logs/fingerprint/stored profile); remove the D6
   strip. Record the harness-sync removal decision in decisions.md. Specs per transport.
5. Phase gate once:
   - `node scripts/verify.mjs --exec --task degradation-audit -- npx nx run degradation-audit:lint`
   - `node scripts/verify.mjs --exec --task di-lint -- npx nx run di-lint:lint`
   - `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
   - `npm run verify -- -t test -p @ptah-extension/vscode-core -- --testPathPatterns=host-attention-ingress`
6. Push (background); watch `gh pr checks 823` (known flakes `state.spec.ts:41`,
   `config-change-permission-survival.spec.ts:204`: rerun once).
7. Probe both variants:
   `npx ts-node --transpile-only -P scripts/codex-start-probe.tsconfig.json -r tsconfig-paths/register scripts/codex-start-probe.ts --model gpt-5.6-luna`
   (and the same with `--no-user-mcp`). Expect OK open; with 8l, the `ptah` server attached.
8. Live test p8f (procedure below; reuse live-test-p8e.md): scenarios a, a2, b, c, d, `/compact`,
   e, f + one `ptah_*` tool call + one call to a user MCP server. Delegate to a test agent.
9. If live passes: P8 re-review (code-logic + code-style, CLAUDE reviewers) of
   `9b5f4c86c..HEAD`, then P9, P10 + Removal B, P14, D9 (history) before P15 Removal A.
10. Follow-up PR (later): P11-P13 + harness-sync Codex removal + one-time block cleanup.

## Verification rules (repeat to every lane)

- `npm run verify -- -p A,B` / `npm run verify -- -t test -p A` (extra Jest flags after a second
  `--`). FIFO counting lock is machine-wide; `node scripts/verify.mjs --status`. Other heavy
  commands: `node scripts/verify.mjs --exec --task <name> -- <cmd>`. Never workspace-wide, never
  `nx run-many`, never positional `nx test A B`, never build/serve/dev/e2e/package except the
  approved Electron live run. Run verify in the background with a LONG timeout (>=90 min): a 10
  min background limit killed a verify mid-run this session and produced false failures.
- Lanes: deliverable paths absolute and declared at spawn; never verify, commit or push; never
  call `ptah_get_diagnostics` (say it explicitly). Check `git status` for undeclared files.
  Change a running lane only by a resume, not `ptah_agent_message`.
- Never npm ci / npm install in a worktree (node_modules is a junction).
- No `as unknown as`, `any`, `@ts-ignore` or `eslint-disable` added by this task.
- Commit in the foreground, explicit paths, `.commitlintrc.json` (scope `task-specs` for docs),
  subject <=72, body lines <=100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Push in the background. No PR merge, force push, history rewrite, branch deletion or worktree
  removal. Do not edit `~/.ptah/settings.json` except the approved live-test backup/restore.

## Electron live-test procedure (run from W)

1. Check that no other root Ptah Dev `electron.exe` runs (no `--type=`). If one does, ask the user.
2. Back up `~/.ptah/settings.json` into a NEW `%TEMP%/ptah-live-p8f-<timestamp>/` folder.
3. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx build-dev ptah-electron`
4. `node scripts/copy-wasm.js dist/apps/ptah-electron`
5. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx copy-renderer-dev ptah-electron`
6. `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1 PTAH_DB_PATH=<folder>/ptah.db PTAH_SESSIONS_DB_PATH=<folder>/sessions.db node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9335 <folder>/ws`
- Port 9335 only. Playwright `connectOverCDP`; scripts in
  `%TEMP%/ptah-live-p8e-20261027-235006/`. Before the first turn: OpenAI Codex / GPT-5.6-Luna
  ("This workspace"), approval mode "Manual". Legacy marker
  `[SessionLifecycle] Starting SDK query with options:` must be 0. Use `MSYS_NO_PATHCONV=1` when
  sending `/compact` from Git Bash. Stop the app with `taskkill /T /F` on THIS worktree's root
  `electron.exe` only. Restore settings.json and confirm with `cmp` (mandatory even on failure).
- Paid: Codex luna only, tiny prompts, <=10 turns.
