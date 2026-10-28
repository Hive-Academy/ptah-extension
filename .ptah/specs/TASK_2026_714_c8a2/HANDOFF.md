# Session handoff — TASK_2026_714_c8a2 (session 19)

Written 2026-10-28. Replaces the session 18 handoff (commit 74c290c28; see
`git log -- .ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`).
At handoff: NO subagent, team-leader or CLI lane of this task is running. No verify of this
worktree is running. The tree is clean. 7 local commits (6 + this handoff) are NOT pushed.

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
- PR #823 scope: P8, P9 gateways, P10 lanes + Removal B, P14 live parity check, P15 Removal A.
  P11 (subagents), P12 (history), P13 (checkpoints) go to the FOLLOW-UP PR.
- D8 (session 18): native Codex chat reaches full parity with Claude main chat: skills, MCP
  servers (Ptah MCP AND the user's MCP servers), system prompts. Native chat HONORS MCP. NEVER
  strip, revert or comment out MCP to bypass a problem. The D6 strip is TEMPORARY (removed in 8l-2).
- P8 D13 (recorded in decisions.md this session): the Codex harness sync (`~/.codex/config.toml`
  `# ptah:begin` blocks + `ptah` entry via `ptah-mcp-slots.ts`, `{ws}/.agents/skills`,
  `{ws}/.codex/agents/*.toml`) is REMOVED COMPLETELY in the FOLLOW-UP PR with a one-time cleanup
  of Ptah-fenced blocks. In PR #823 the per-thread native `mcp_servers.ptah` entry overrides the
  synced one; the user's hand-written entries (e.g. `node_repl`) are not touched.
- D10: the dev-only probe `scripts/codex-start-probe.ts` is approved (coordinator runs it).
- D9 (history after reload) is REQUIRED before Removal A (P15).
- Live Electron test is approved: build-dev, `PTAH_CODEX_RUNTIME_DEV=1`, Codex luna only,
  <=10 paid turns per run, settings.json backup + `cmp` restore, approval mode "Manual" first.
- Another worktree's Ptah Dev app holding the single-instance lock is NOT killed without asking.

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #823 https://github.com/Hive-Academy/ptah-extension/pull/823 | `feat/codex-runtime-integration` / W | DRAFT, do not merge. Remote head 74c290c28: CI GREEN (19 pass, 4 skipped). 7 local commits NOT pushed (push after the 8l phase gate). No reviews. |
| #824, #826 | `fix/provider-switch-model-sync`, `fix/host-stored-model-validation` | MERGED. Worktrees + branches kept until the user authorizes cleanup. |

## Done this session (session 19), all local, not pushed

| Commit | Subject / result |
| --- | --- |
| 5598b15c1 | fix(rpc-handlers): native Codex approvals get a UUID renderer wire id (D11 host side, 8k-3 COMPLETE). Verify rpc-handlers + ptah-electron 12/12 |
| c1b2a1364 | test(rpc-handlers): `codex-chat-native-contract.spec.ts` — 3 end-to-end specs (8k-5): native turn lifecycle == Claude fixture turn; approval passes real `parsePermissionRequest`, toolUseId == tool_start id; stop during approval -> abort, `aborted_streaming`, prompt cancelled once, notice released with wire id. Verify rpc-handlers 3/3 |
| 0dd1aa9d8 | docs(task-specs): batch 8k-5 record + batch-8k-5-report.md |
| 4f12d4c04 | feat(codex-runtime): 8l-1a `codex-mcp-config.ts` `buildCodexMcpConfigOverrides` (one dotted `mcp_servers.<name>` key per server; stdio/http/sse; secrets resolved from a separate map); profile fields `toolTimeoutSec`, `urlReference`, safe server names; mcpServers OUT of the fingerprint. Verify codex-runtime PASS |
| f3d9e950c | feat(codex-runtime,agent-sdk): 8l-1b `codex-runtime.ts` no longer refuses chat profiles with mcpServers (lane refusal stays first); `config` on thread/start + thread/resume; `open(profile, resume?, secrets?)`; chat adapter passes `secrets` from `ports.profile`. Verify codex-runtime PASS (909), agent-sdk test + typecheck PASS; agent-sdk lint only the known pre-existing `session-query-executor.accounts.spec.ts:174,183` |
| bcd3d38a4 | docs(task-specs): Round 8l section in batches.md (before "# Phase P9"), P8 D13 rows, batch-8l-1a/1b reports |

Team-leader decisions in 8l (recorded under P8 D13, reversible; CHECK in the P8 re-review):
1. MCP servers are not part of the thread fingerprint (re-sent on every start/resume, like model).
   Native threads saved before 8l do not resume (acceptable: dev flag only).
2. Ptah MCP URL for chat = `/session/{tabId else sessionId}/workspace/{cwd}` (same shape as
   Claude). `ptahMcpServerUrl` builds only the lane `/agent/` shape; 8l-1c adds a session-scoped
   sibling builder.
3. Server names with dots (OAuth keys) are refused by the core; 8l-2 maps them to `_` on the host
   and fails visibly on a collision.
4. URLs with a secret in the query (legacy Smithery): profile stores origin + path plus
   `urlReference`; the runtime checks that the resolved URL has the same origin and path.

## In progress

Nothing is uncommitted. Round 8l is about half done: the runtime CAN open threads with MCP
servers, but Codex chat does NOT attach Ptah MCP or the user's servers yet (host side not started).

## Open problems and deferred items

- 8l-1c PENDING: session-scoped Ptah MCP URL builder; export `CODEX_PTAH_TOOL_TIMEOUT_SEC`
  (cli-agent-runtime `codex-lane-config.builder.ts:50`); Ptah entry in the chat host ports
  (`codex-chat-host-ports.ts` profile build); remove the "Ptah MCP is not attached" log (~:157).
- 8l-2 PENDING: `mcpServersOverride` -> servers + secrets map; remove the D6 strip, its notice and
  the not-attached log (7 files, one atomic change; see batches.md Round 8l).
- 8l-3 PENDING: 8k-5 finding 3 — follow-up native turns possibly torn down after each turn
  (`codex-chat-host-ports.ts:428-429` publishes under the session id;
  `chat-stream-broadcaster.service.ts:155, :412-440` ends the session on token match;
  `codex-chat-adapter.ts:561-583`). Pin with a spec; fix if real (follow-up must continue the
  live thread like Claude).
- 8k-5 findings 1-2 (record only): renderer parser drops `allowedDecisions`
  (`libs/shared/src/lib/types/permission.parsers.ts:47-107`); an answered native prompt also sends
  PERMISSION_AUTO_RESOLVED (`codex-chat-host-ports.ts:332-341`).
- 8l risks for the probe / live test: (a) the App Server applying thread `config` dotted keys is
  UNPROVEN (fallback: process `-c` override, proven by the evidence harness); (b) whether Codex
  writes thread config values (secrets) into rollout files is unverified; (c) the redacted
  `stderrTail` is the only guard against a secret echoed on stderr.
- 8l verify not run yet for cli-agent-runtime, rpc-handlers, ptah-electron, gateway-chat-bridge
  (the `open` change only adds an optional parameter).
- Header Tokens/Cost stay "—" (needs cumulative per-run totals; no Codex pricing).
- `fileChange` edits keep the raw name; only single-file add -> `Write`.
- Streaming gaps: `item/reasoning/*Delta`, `item/commandExecution|fileChange/outputDelta` ignored.
- Recorded-stream fixtures in CI; count ignored notification methods in the parity report.
- `session-rpc.handlers.ts:125` local copy of the thread-record schema (parser not exported).
- Probe: a normal close logs "Codex process failure / process exited" (wrong wording).
- Unknown server REQUEST with an extra top-level key still kills the process.
- Known pre-existing lint noise: agent-sdk `session-query-executor.accounts.spec.ts:174,183`. Do
  not fix in this PR.
- Process: Codex `backend-developer` lanes call `ptah_get_diagnostics` despite the ban (role
  preamble). The 8l Glm lanes complied.
- Process: lane completion signals arrive at the COORDINATOR. Relay each one (report + exit
  signal, files, CLI session id) to the team-leader with SendMessage.
- Codex weekly limit reset to about 1% during session 19 (Codex lanes usable again).
- Separate small PRs from `main` (own worktrees): S-N0 (hidden-tab terminal overwrite,
  `chat-stream-delivery-coordinator.service.ts:232-235`) and LIVE D4 (save to "This workspace"
  also writes global `provider.openai-codex.mainAgent.modelTier.*`).

## Lanes of session 19 (all Glm, ptah-cli, all finished)

| Work | Agent id | CLI session (resume) |
| --- | --- | --- |
| 8l-1a | b178fcd0-fb65-4667-b9e6-3633ac612cb5 | f2770d18-7a83-4317-8d5d-efe0b1f006ca |
| 8l-1a fix | d53b0db6-ef22-4468-9257-37c89c5e4f80 | 3ac1957e-67a4-4298-a91e-55e27fe2789a |
| 8l-1b | 6f7c2204-c898-437f-82b7-baadf9e89a18 | d9597c1b-df4c-4932-85b2-180f97eed1cf |
| TS4111 fix | 8931360c-5ccf-419e-84f2-6d0a0d8634e8 | fe2b22b9-ceaf-40a6-92d1-3f5c4cc9d4ab |
| adapter spec fix | 7c82e1ba-8669-4b27-8506-bbe884a5da23 | f4ce4abf-0f5a-495c-a345-49b27697263f |

## Key files

- W/.ptah/specs/TASK_2026_714_c8a2/batches.md — source of truth ("Batch 8k", "Round 8l" with the
  8l-1c/8l-2/8l-3 plans; P9, P10, Removal B, P14, P15 further down). decisions.md (P8 D1-D13).
  Reports: batch-8k-5-report.md, batch-8l-1a-report.md, batch-8l-1b-report.md.
- W/.ptah/specs/TASK_2026_714_c8a2/live-test-p8e.md — latest live evidence and procedure.
- W/scripts/codex-start-probe.ts — free start probe (no Electron, no turn).
- W/libs/backend/codex-runtime/src/lib/: codex-runtime.ts (open with config), codex-mcp-config.ts
  (NEW), codex-execution-profile.ts, codex-runtime.types.ts, codex-app-server-process.ts,
  codex-event-translator.ts, codex-approval-bridge.ts.
- W/libs/backend/agent-sdk/src/lib/codex-app-server/: codex-chat-adapter.ts (secrets pass-through),
  codex-chat-turn-stream.ts, codex-chat-events.ts, codex-chat-approval-sink.ts.
- W/libs/backend/rpc-handlers/src/lib/chat/codex-host/: codex-chat-host-ports.ts (profile build,
  approvals, not-attached log), codex-chat-profile-options.ts (D6 strip list),
  codex-chat-native-contract.spec.ts (NEW, 8k-5).
- Ptah MCP URL builders: W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/
  ptah-mcp-url.ts and codex/codex-lane-config.builder.ts:50, :147-156.
- Harness sync to remove in the FOLLOW-UP PR: W/libs/backend/harness-sync/src/lib/targets/mcp/
  codex-toml-mcp-facet.ts, targets/rival-targets.ts (`createCodexTarget`),
  W/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/ptah-mcp-slots.ts (Codex rows).

## Next steps (in order)

1. In W: `git status -sb` (expect clean, ahead 7), `node scripts/verify.mjs --status`.
2. Start a FRESH team-leader for the rest of Round 8l (8l-1c, then 8l-2, then 8l-3), from
   batches.md "Round 8l". Delegate verify-and-commit per batch to it; no push. Relay every lane
   report and exit signal to it with SendMessage. Per batch verify, for example:
   - `npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers`
   - `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron`
   - also `@ptah-extension/gateway-chat-bridge` once (the `open` signature changed).
3. Phase gate once after 8l:
   - `node scripts/verify.mjs --exec --task degradation-audit -- npx nx run degradation-audit:lint`
   - `node scripts/verify.mjs --exec --task di-lint -- npx nx run di-lint:lint`
   - `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
   - `npm run verify -- -t test -p @ptah-extension/vscode-core -- --testPathPatterns=host-attention-ingress`
4. Push in the background (`git push`); watch `gh pr checks 823` (known flakes `state.spec.ts:41`,
   `config-change-permission-survival.spec.ts:204`: rerun once).
5. Probe both variants:
   `npx ts-node --transpile-only -P scripts/codex-start-probe.tsconfig.json -r tsconfig-paths/register scripts/codex-start-probe.ts --model gpt-5.6-luna`
   (and with `--no-user-mcp`). Expect OK open with the `ptah` server attached from the thread
   config. If the thread `config` keys are not applied, use the process `-c` fallback (record it).
   Check the Codex rollout files for secret values.
6. Live test p8f (procedure below; reuse live-test-p8e.md): scenarios a, a2 (follow-up turn, see
   8l-3), b, c, d, `/compact`, e, f + one `ptah_*` tool call + one call to a user MCP server.
   Delegate to a test agent.
7. If live passes: P8 re-review (code-logic + code-style, Claude reviewers) of `9b5f4c86c..HEAD`
   (include the P8 D13 team-leader decisions and 8k-5 findings 1-2), then P9, P10 + Removal B,
   P14, D9 (history) before P15 Removal A.
8. Follow-up PR (later): P11-P13 + harness-sync Codex removal + one-time block cleanup.

## Verification rules (repeat to every lane)

- `npm run verify -- -p A,B` / `npm run verify -- -t test -p A` (extra Jest flags after a second
  `--`). FIFO counting lock is machine-wide; `node scripts/verify.mjs --status`. Other heavy
  commands: `node scripts/verify.mjs --exec --task <name> -- <cmd>`. Never workspace-wide, never
  `nx run-many`, never positional `nx test A B`, never build/serve/dev/e2e/package except the
  approved Electron live run. Run verify in the background with a LONG timeout (>=90 min).
- Lanes: deliverable paths absolute and declared at spawn; never verify, commit or push; never
  call `ptah_get_diagnostics` (say it explicitly). Check `git status` for undeclared files.
  Change a running lane only by a resume, not `ptah_agent_message`.
- Never npm ci / npm install in a worktree (node_modules is a junction).
- No `as unknown as`, `any`, `@ts-ignore` or `eslint-disable` added by this task.
- Commit in the foreground, explicit paths, `.commitlintrc.json` (scope `task-specs` for docs),
  subject <=72, body lines <=100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Push in the background. No PR merge, force push, history rewrite, branch deletion or worktree
  removal. Do not edit `~/.ptah/settings.json` except the approved live-test backup/restore.
  Do not edit `~/.codex/config.toml`.
- Never run two committing team-leaders on the branch at the same time (lint-staged hides the
  other's unstaged edits).

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
