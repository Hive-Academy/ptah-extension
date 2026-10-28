# Session handoff — TASK_2026_714_c8a2 (session 20)

Written 2026-10-28. Replaces the session 19 handoff (commit 1e73f33b8; see
`git log -- .ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`).
At handoff: NO subagent, team-leader, CLI lane, verify or CI watcher of this task is running.
The tree is clean. Local commits after `def0ac005` (this handoff included) are NOT pushed.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`). Main checkout = `D:\projects\ptah-extension` (stays on
`main`, no task changes; its pre-existing dirty files are NOT ours, do not touch them).

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. Then DELETE
legacy path B (`@openai/codex-sdk`, CLI lanes) and path A (Claude Agent SDK + Codex translation
proxy for Codex main chat). Claude behavior unchanged. Electron first. No runtime-selector UI.
Native chat must produce EXACTLY the same UI contracts as Claude (`FlatStreamEventUnion`,
`turn_state`, `PermissionRequest`, the AskUserQuestion flow, tool input/output shapes, session
RPCs); never special-case the frontend for Codex. The translation layer is the BACKEND
(codex-runtime translator/approval bridge -> agent-sdk codex-app-server -> rpc-handlers
codex-host). The user agreed (session 20): no second proxy layer; fix gaps in this layer.

## User decisions (all confirmed by the user; full table in decisions.md)

- PR #823 is NOT merged by us. Pre-existing defects go out as SEPARATE small PRs from `main`;
  `main` is MERGED into the branch (merge commit, no rebase, no force push).
- Native App Server features first; build only where they do not exist.
- Identity store = option A (SessionMetadataStore). Removal B at the END of P10.
- PR #823 scope: P8, P9 gateways, P10 lanes + Removal B, P14 live parity check, P15 Removal A.
  P11 (subagents), P12 (history), P13 (checkpoints) go to the FOLLOW-UP PR.
- D8: native Codex chat reaches full parity with Claude main chat: skills, MCP servers (Ptah MCP
  AND the user's MCP servers), system prompts. NEVER strip, revert or comment out MCP to bypass a
  problem. (The D6 strip is now REMOVED, 8l-2.)
- P8 D13: the Codex harness sync (`~/.codex/config.toml` `# ptah:begin` blocks + `ptah` entry,
  `{ws}/.agents/skills`, `{ws}/.codex/agents/*.toml`) is removed in the FOLLOW-UP PR with a
  one-time cleanup. In PR #823 the per-thread `mcp_servers.ptah` entry overrides the synced one.
- D10: the dev-only probe `scripts/codex-start-probe.ts` is approved (coordinator runs it).
- D9 (history after reload) is REQUIRED before Removal A (P15).
- Live Electron test is approved: build-dev, `PTAH_CODEX_RUNTIME_DEV=1`, Codex luna only,
  <=10 paid turns per run, settings.json backup + `cmp` restore, approval mode "Manual" first.
- Session 20: the user APPROVED Round 8m (protocol parity, incl. G6) and asked to PARALLELIZE it
  with CLI lanes (codex, Glm, grok/antigravity) in waves.
- Another worktree's Ptah Dev app holding the single-instance lock is NOT killed without asking.

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #823 https://github.com/Hive-Academy/ptah-extension/pull/823 | `feat/codex-runtime-integration` / W | DRAFT, do not merge. Remote head `def0ac005`. **NO CI workflow run started for def0ac005** (only GitGuardian pass, CodeRabbit skipping; `gh api .../actions/runs?head_sha=def0ac005...` total_count 0). Last green CI: 74c290c28. Local commits after def0ac005 NOT pushed. No reviews. |
| #824, #826 | `fix/provider-switch-model-sync`, `fix/host-stored-model-validation` | MERGED. Worktrees + branches kept until the user authorizes cleanup. |

## Done this session (session 20)

Pushed (remote head def0ac005):

| Commit | Subject / result |
| --- | --- |
| b959b58d9, 46af84bca | 8l-1c: `ptahMcpSessionUrl` (`/session/{tabId else sessionId}/workspace/{cwd}`), `CODEX_PTAH_TOOL_TIMEOUT_SEC` exported; chat profile gets `ptah` http server (960 s); coded error `ptah-mcp-routing-id-missing`; not-attached log removed. Verify cli-agent-runtime + rpc-handlers 6/6 |
| 9b364c658, 7b7763452 | 8l-2: user MCP servers from `mcpServersOverride` -> servers + secrets map (header refs, `urlReference`, `_` name mapping + collision error); user `ptah` replaces Ptah's like Claude; D6 strip + notice + not-attached log removed. Verify rpc-handlers 3/3 |
| e448b5517, ca01fcaa8 | 8l-3: defect REAL in 2 places, fixed: `CodexChatAdapter.endSessionIfTokenMatches` no longer closes the thread; `SessionRuntimeRouter.acceptsFollowUpWithoutStream` lets `chat:continue` reuse an idle native thread. Verify agent-sdk/rpc-handlers/ptah-electron 14/15 (only known agent-sdk lint) |
| (verify) | gateway-chat-bridge 3/3 |
| def0ac005 | fix(codex-runtime): `parseUrl` uses `URL.canParse` (phase gate degradation-audit had flagged `codex-mcp-config.ts:85`) |
| phase gate | degradation-audit PASS (279, no FAIL), di-lint PASS, typecheck ptah-electron/vscode/cli/tui 4/4, vscode-core host-attention-ingress PASS |

Local, NOT pushed:

| Commit | Subject / result |
| --- | --- |
| f3ea834f1 | feat(scripts,task-specs): probe `--mcp` option + `probe-8l-report.md`. Result: the App Server APPLIES thread `config` `mcp_servers.<name>` keys (risk 8l(a) CLOSED, no `-c` fallback needed); fake secret in 0 of 15 changed files under `~/.codex` |
| 88404d091 | docs(task-specs): `live-test-p8f.md` (9 luna turns + /compact) |
| fa786d743 | docs(task-specs): Round 8m plan in batches.md (3 waves, 7 batches) + decisions P8 D14-D18 |
| (this) | docs(task-specs): session 20 handoff |

Team-leader decisions in 8l (P8 D13 rows 5-8, reversible; CHECK in the P8 re-review): 5 coded
error when MCP runs and no routing id; 6 a resumed thread gets Ptah MCP but not the user's
servers (matches Claude resume); 7 8l was written by Claude subagents (re-review needs a different
family or record the exception); 8 the two-part 8l-3 fix (broadcaster unchanged).

## Live test p8f (session 20) — summary

PASS: first turn; follow-up on the live thread (no interrupt / cold resume); Allow + Deny cards;
new session; one `ptah_workspace_analyze` tool card; legacy marker 0; `codex-user-mcp-attached`
logged; 0 secret hits in app.log and 2 new rollout files; settings.json restored, `cmp` OK.
NOT PROVEN: user MCP tool call (only `smithery` attaches; `mcp.smithery.run` does not resolve;
OAuth servers have no token); the session-scoped URL path (not logged; `callerKind:"session"` used).
Evidence: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8f-20261028-173047\` (shots, app.log).
Correction by the user: in Manual mode the user NEVER saw a permission card. The tester's PASS for
scenario b needed a prompt that told Codex to "request require_escalated" -> gap G6 below.

## In progress: Round 8m "protocol parity" (APPROVED, PLANNED, NOT STARTED)

batches.md "Round 8m" (before "# Phase P9") has the full plan; decisions.md P8 D14-D18. No lane
was spawned; no code changed. Gaps:

- G6 (HIGHEST): Manual (`ask`) maps to read-only sandbox + granular approvals
  (`codex-execution-profile.ts:226-255`), so Codex asks only when the model escalates; a normal
  write fails with no card. D14: `ask` and `auto-edit` -> approvalPolicy `untrusted` +
  workspace-write (cwd only, no network); `plan`/`yolo` unchanged. Needs a live proof that an
  approved command does not prompt twice; the fingerprint change may refuse resume of older
  threads (8m-1 must pin it).
- G1: `codex-event-translator.ts:277, :297, :350` replace real failed/declined tool results with
  "Codex could not complete this operation."; L2: failed command card says "Command succeeded".
- G2: `presentCodexTool` puts `cwd` into Bash input (card shows "Arguments"); Claude = {command, description}.
- G3: empty "Extended Thinking" blocks (`item/reasoning/*Delta` ignored).
- G4: `requestUserInput` is wired by NO host (`codex-runtime.ts:59/376`,
  `codex-approval-bridge.ts:339` answers `{}`); must use Claude's AskUserQuestion flow. Check mcpElicitation.
- G5: parser drops `allowedDecisions` (`libs/shared/src/lib/types/permission.parsers.ts:47-107`);
  answered prompt also sends PERMISSION_AUTO_RESOLVED (`codex-chat-host-ports.ts:332-341`). D16: remove `allowedDecisions` everywhere.
- L1 (medium): Stop during an approval kills the Codex process; next send fails `CODEX_UNAVAILABLE`
  (`chat-session.service.ts:566-568`, `chat-slash-command-router.service.ts:260-330`). D17: interrupt the turn, keep the session.
- L3 (low): log Ptah MCP attach + URL path shape; log user MCP as "configured", not reachable.
- L2b (low): sessions rail keeps stale preview (only if the cause is backend).

Waves (lanes at most 3 in flight; wave lanes all finish BEFORE its commits):

| Wave | Batch | Gaps | Lane | Projects |
| --- | --- | --- | --- | --- |
| 1 | 8m-1 | G6 + contract spec | codex | codex-runtime, rpc-handlers |
| 1 | 8m-2 | G1 core, G3 core | Glm | codex-runtime (+ agent-sdk typecheck) |
| 1 | 8m-3 | G5 host, L3, L2b check | grok, else antigravity | rpc-handlers |
| 2 | 8m-4 | G2, G1/G3 presentation, L2 | Glm | agent-sdk, rpc-handlers |
| 2 | 8m-5 | L1 | codex | agent-sdk, rpc-handlers |
| 2 | 8m-6 | G5 shared/frontend removal of `allowedDecisions` | grok or antigravity | shared, chat-streaming, chat |
| 3 | 8m-7 | G4 (+ mcpElicitation) | codex | rpc-handlers, ptah-electron |

CLI agents at 14:45 UTC: codex (weekly 4%), Glm (ptah-cli, ptahCliId
`pc-355b645d-35af-4974-84cf-9cf961ea0164`), grok (limits unknown), antigravity (limit reader
failed). opencode AT LIMIT until 2026-11-04. Check `ptah_agent_list` again.

## Open problems and deferred items

- CI did not start for def0ac005 (0 workflow runs). Push again after the next commits and check
  `gh api repos/Hive-Academy/ptah-extension/actions/runs?head_sha=<sha>`; if still 0, inspect the
  workflow triggers / Actions state and report to the user.
- The user MCP tool call is not proven live (needs a reachable user server; ask the user which).
- 8m-6 lint: the `chat` project already has lint errors on main (lazy-load imports); compare with main.
- Header Tokens/Cost stay "—" (needs cumulative per-run totals; no Codex pricing).
- `fileChange` edits keep the raw name; only single-file add -> `Write`.
- `item/commandExecution|fileChange/outputDelta` ignored (streaming gap).
- Recorded-stream fixtures in CI; count ignored notification methods in the parity report.
- `session-rpc.handlers.ts:125` local copy of the thread-record schema (parser not exported).
- Probe: a normal close logs "Codex process failure / process exited" (wrong wording).
- Broadcaster logs "was already ended before stream exit" after each Codex turn (wrong wording).
- Unknown server REQUEST with an extra top-level key still kills the process.
- Known pre-existing lint noise: agent-sdk `session-query-executor.accounts.spec.ts:174,183`. Do not fix.
- A Playwright e2e electron.exe from worktree `wizard-library-alignment` (own temp user-data-dir,
  no parent, started 16:36) was running; NOT ours, not killed.
- Scratch file outside W (not task): `D:\projects\ptah-extension\.ptah\tmp\round8m-batches.md` (may be deleted).
- Separate small PRs from `main` (own worktrees): S-N0 (hidden-tab terminal overwrite,
  `chat-stream-delivery-coordinator.service.ts:232-235`) and LIVE D4 (save to "This workspace"
  also writes global `provider.openai-codex.mainAgent.modelTier.*`).
- Process: codex `backend-developer` lanes called `ptah_get_diagnostics` despite the ban; put the
  ban in the FIRST lines of every lane task.

## Key files

- W/.ptah/specs/TASK_2026_714_c8a2/: batches.md ("Round 8l" done, "Round 8m" plan; P9, P10,
  Removal B, P14, P15 further down), decisions.md (P8 D1-D18), live-test-p8f.md, probe-8l-report.md,
  batch-8l-1c/8l-2/8l-3-report.md, batch-8k-5-report.md, live-test-p8e.md.
- W/scripts/codex-start-probe.ts (`--no-user-mcp`, `--mcp`).
- W/libs/backend/codex-runtime/src/lib/: codex-execution-profile.ts (G6), codex-event-translator.ts
  (G1/G3), codex-approval-bridge.ts (G4), codex-runtime.ts, codex-mcp-config.ts.
- W/libs/backend/agent-sdk/src/lib/codex-app-server/: codex-chat-events.ts, codex-tool-presentation.ts
  (G2), codex-chat-adapter.ts, session-runtime-router (8l-3).
- W/libs/backend/rpc-handlers/src/lib/chat/: codex-host/codex-chat-host-ports.ts (G5, L3),
  codex-host/codex-chat-native-contract.spec.ts (parity specs), chat-session.service.ts (L1),
  chat-slash-command-router.service.ts (L1).
- W/libs/shared/src/lib/types/permission.parsers.ts (G5).
- Harness sync to remove in the FOLLOW-UP PR: harness-sync `targets/mcp/codex-toml-mcp-facet.ts`,
  `targets/rival-targets.ts`, vscode-lm-tools `mcp-http/ptah-mcp-slots.ts` (Codex rows).

## Next steps (in order)

1. In W: `git status -sb` (expect clean, 4 ahead of origin), `node scripts/verify.mjs --status`.
2. Push in the background (`git push`, pre-push runs di-lint + Electron validate-deps). Then check
   that CI runs exist for the new head (see "CI did not start" above) and watch `gh pr checks 823`
   in the background (known flakes `state.spec.ts:41`, `config-change-permission-survival.spec.ts:204`: rerun once).
3. Start a FRESH team-leader for Round 8m (verify-and-commit mode; batches.md "Round 8m" exists).
   Run waves 1-3 as parallel CLI lanes (codex, Glm, grok/antigravity) in W. Commit only after all
   lanes of a wave finished. Relay each lane completion signal to the team-leader with SendMessage.
   Per-batch verify, for example:
   - `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/rpc-handlers`
   - `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron`
   - shared changes: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/chat-streaming,@ptah-extension/chat`
     and `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
   End of round: degradation-audit + di-lint (commands in step 4).
4. Phase gate once after 8m:
   - `node scripts/verify.mjs --exec --task degradation-audit -- npx nx run degradation-audit:lint --output-style=static`
   - `node scripts/verify.mjs --exec --task di-lint -- npx nx run di-lint:lint`
   - `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
   - `npm run verify -- -t test -p @ptah-extension/vscode-core -- --testPathPatterns=host-attention-ingress`
5. Push (background), watch CI.
6. Live test p8g (procedure below, delegated to a test agent): G6 with PLAIN prompts (no escalation
   wording): a write command and a file edit must show the card BEFORE the action, Allow completes
   with no second prompt, Deny blocks; Stop during approval then a plain follow-up AND `/compact`
   work (L1); failed command shows the real output (G1/L2); Bash card has no "Arguments" (G2); no
   empty thinking blocks (G3); a Codex user question shows Claude's question card (G4); one
   `ptah_*` call; one user MCP call if a reachable server exists (ask the user); rollout secret scan.
7. If live passes: P8 re-review (code-logic + code-style, Claude reviewers) of `9b5f4c86c..HEAD`
   (include P8 D13 rows 5-8, D14-D18; batches written by Claude subagents need the different-family
   exception recorded), then P9, P10 + Removal B, P14, D9 (history) before P15 Removal A.
8. Follow-up PR (later): P11-P13 + harness-sync Codex removal + one-time block cleanup.

## Verification rules (repeat to every lane)

- `npm run verify -- -p A,B` / `npm run verify -- -t test -p A` (extra Jest flags after a second
  `--`). FIFO counting lock is machine-wide; `node scripts/verify.mjs --status`. Other heavy
  commands: `node scripts/verify.mjs --exec --task <name> -- <cmd>`. Never workspace-wide, never
  `nx run-many`, never positional `nx test A B`, never build/serve/dev/e2e/package except the
  approved Electron live run. Run verify in the background with a LONG timeout (>=90 min).
  Confirm "Running target X for N projects" matches the request.
- Lanes: deliverable paths absolute and declared at spawn; never verify, commit or push; never
  call `ptah_get_diagnostics` (say it explicitly, first lines). Check `git status` for undeclared
  files. Change a running lane only by a resume, not `ptah_agent_message`.
- Never npm ci / npm install in a worktree (node_modules is a junction).
- No `as unknown as`, `any`, `@ts-ignore` or `eslint-disable` added by this task.
- Commit in the foreground, explicit paths, `.commitlintrc.json` (scope `task-specs` for docs,
  `scripts` for the probe), subject <=72, body lines <=100, end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push in the background. No PR merge,
  force push, history rewrite, branch deletion or worktree removal. Do not edit
  `~/.ptah/settings.json` except the approved live-test backup/restore. Do not edit `~/.codex/config.toml`.
- Never run two committing team-leaders on the branch at the same time, and never commit while a
  lane is still editing files in W (lint-staged hides unstaged edits during the hook).

## Electron live-test procedure (run from W)

1. Check that no other root Ptah Dev `electron.exe` of the default profile runs (no `--type=`).
   If one does, ask the user. Playwright e2e electrons with their own `--user-data-dir` do not block.
2. Back up `~/.ptah/settings.json` into a NEW `%TEMP%/ptah-live-p8g-<timestamp>/` folder.
3. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx build-dev ptah-electron`
4. `node scripts/copy-wasm.js dist/apps/ptah-electron`
5. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx copy-renderer-dev ptah-electron`
6. `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1 PTAH_DB_PATH=<folder>/ptah.db PTAH_SESSIONS_DB_PATH=<folder>/sessions.db node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9335 <folder>/ws`
- Port 9335 only. Playwright `connectOverCDP`; reusable scripts in
  `%TEMP%/ptah-live-p8e-20261027-235006/` and `%TEMP%/ptah-live-p8f-20261028-173047/`. Before the
  first turn: OpenAI Codex / GPT-5.6-Luna ("This workspace"), approval mode "Manual". Legacy
  marker `[SessionLifecycle] Starting SDK query with options:` must be 0. Use `MSYS_NO_PATHCONV=1`
  when sending `/compact` from Git Bash. Stop the app with `taskkill /T /F` on THIS worktree's root
  `electron.exe` only. Restore settings.json and confirm with `cmp` (mandatory even on failure).
- Paid: Codex luna only, tiny prompts, <=10 turns. A scenario that passes only with special
  prompt wording is NOT a pass (record it as a gap).
