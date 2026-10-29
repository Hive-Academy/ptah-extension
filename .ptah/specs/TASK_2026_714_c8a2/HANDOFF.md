# Session handoff — TASK_2026_714_c8a2 (session 25)

Written 2026-10-29. Replaces the session 24 handoff (commit 44e3b1102; read it with
`git show 44e3b1102:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md` for the full Goal, PR table, older
open items, key-file list and Rules — all still valid). The Electron live-test procedure is in
`git show e10bb860a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, DRAFT PR #823, do not merge). T = `W\.ptah\specs\TASK_2026_714_c8a2\`.

**USER INSTRUCTION (session 25 end, usage at 98%): use Codex and other CLI lanes heavily and
REPLACE Claude subagents for the remaining work** — implementation, reviews (code-logic, security,
style) and team-leader-style planning where possible. Lanes: codex (`gpt-6-sol`, ~27% weekly
used, resets 2026-11-04; NEVER `gpt-6.1-terra`) and grok. Glm and opencode are at their limits.
The coordinator (you) runs verify, commit and push itself; lanes never do.

## Goal (short)

One Codex App Server runtime (`@ptah-extension/codex-runtime`) for Ptah main chat, gateways and
CLI lanes; then Removal B (P10, `@openai/codex-sdk` lanes) and Removal A (P15, Claude SDK + Codex
translation proxy for Codex main chat). Electron first. Native UI contracts identical to Claude's;
fix gaps only in the backend translation layer; no frontend Codex special case; no second proxy;
NEVER strip/revert/comment out MCP.

## New decisions (session 25) — D24 (user) and D25 (coordinator) in decisions.md

1. D23 alternative REJECTED: keep the coded resume refusal on a policy change (D14a).
2. `-NoProfile` stays optional for auto-accepted reads. 3. Bare `powershell`/`pwsh` stay accepted.
4. GAP-3 APPROVED: Codex chat gets the user's MCP servers from `~/.claude.json`, user AND project
   scope, stdio and HTTP, via `cli-agent-runtime mcp-directory/claude-user-mcp.reader.ts` — build in P14.
5. D25 (reversible): `PTAH_CODEX_RUNTIME_DEV=1` covers the gateway consumer too; the unwired 9a
   `CodexGatewayAdapter`/`CodexGatewayApprovalSink` are deleted in 9b-7.

## Done in session 25 (all pushed; origin head 8ea186c34; CI GREEN: 19 pass, 4 skipped)

| Commit | What |
| --- | --- |
| 80b916f98 | 8p-4: typed Codex resume refusals in chat; attachment fixes; 2 stale specs fixed. Chat-path verify 15/15. |
| 03d37d067 | Merge of main (conflicts: sdk-agent-adapter auth call, workspace-provider-profile-resolver ctor + spec, shutdown.spec). PR was CONFLICTING, so CI had not run before. |
| edad8d577 | 8p-8: SystemRoot trust `X:\Name` only (no dot segments), reject powershell inside the thread folder, `hasReason` boolean log, disposed sink skips edit follow-up, `CodexRuntimeOptions` exported from codex-context. Review APPROVED. Verify 12/12. |
| cd947b54c | docs: Round 8p closed, D24. Round 8p phase gate PASS (degradation-audit, di-lint, typecheck 4/4 hosts). |
| 35de06338 | docs: live test p8j report (T\live-test-p8j.md), P9 re-plan (batches.md "Round P9": 9b-1..9b-7 + 9b-5a), D25. |
| 1e64b6c4b | 9b-1: gateway consumer contract (shared `consumer?`, `nativeCodexGateway`; resolver exhaustive switch). Review APPROVE 8/10. |
| 8ea186c34 | docs: T\research-p8j-gaps.md (root causes of the p8j gaps). |

Live test p8j (head cd947b54c, gpt-6-sol, 8 paid turns, settings `cmp` OK, port 9336; evidence
`%TEMP%\ptah-live-p8j-20261029\`): question card dismissed on Stop PASS; first follow-up after
restart PASS; read auto-accept FAIL; D14a GAP. Root causes: reads = the classifier had no named
PowerShell parameters (`-TotalCount`, `-Name`); D14a = host defaults every Codex profile to `ask`
(`codex-chat-host-ports.ts:393`) and `codex-context.ts` threw on a live level change. Transcript
drop after reload = D9 family (known).

## UPDATE at handoff (supersedes the details below where they differ)

- 8q-1 COMMITTED `79a79c391` (fix(agent-sdk): bounded PowerShell read grammar; includes the
  Round 8q plan in batches.md, batch-8q-1-report.md, security-review-8q-1.md). NOT pushed.
- 8q-2a COMMITTED `9c17cfa34` (refactor(rpc-handlers): one saved Codex level helper; takes an
  `invalidSettings` callback to avoid an import cycle). NOT pushed.
- 8q-3a NOT committed. Wave 1 verify (codex-runtime, cli-agent-runtime, gateway-chat-bridge,
  agent-sdk, rpc-handlers) failed only on a type error at `codex-runtime.spec.ts:1486` (fixture
  `permissionLevel` typed as `string`); all other suites passed, lint warnings only.
- RUNNING: codex lane `8027c8c0...` (gpt-6-sol, started by the ended team-leader) fixes that type
  error plus 8q-3a M1 and M2 with specs; report `T\batch-8q-3a-fix-report.md`. Its signal comes to
  the coordinator session. When it stops: re-run the Wave 1 verify above, then commit 8q-3a
  together with the 4-spec mock fix and batch-8q-3a-report.md, batch-8q-3a-mockfix-report.md,
  batch-8q-3a-fix-report.md, security-review-8q-3a.md, and the uncommitted batches.md carry-over
  (M3 closed by 8q-3b; minors noted; 8q-3b gets its own security review). Then push.
- LANE REPORT RECEIVED (end of session 25): lane `8027c8c0` reports the fix round DONE — typed
  `initialProfile` fixture; `updateNextTurn` persist tracked with a close-safe commit and cleanup
  (M1); notification-started turn gets a level snapshot (M2); close-race and notification-turn
  specs added. Files: codex-runtime `codex-context.ts`, `codex-runtime.spec.ts`,
  `T\batch-8q-3a-fix-report.md`. Lane COMPLETED (exit 0, 3m 30s, verdict delivered; CLI session
  `01a18867-5769-7470-94ee-e2234341dd22` for a resume). No lane edits W now: run the Wave 1 verify
  and commit 8q-3a.
- HANDOFF.md itself is uncommitted; commit it with the 8q-3a commit or separately.

## In progress — Round 8q (plan in batches.md "## Round 8q", line ~4171)

The Claude team-leader subagent that ran Round 8q ended with this session. Its state:
- Wave 1 lanes all finished: 8q-1 (classifier named-parameter grammar + sink names-only reason
  log), 8q-2a (`codex-saved-permission-level.ts` helper + spec; `codex-session-settings-record.ts`
  uses it), 8q-3a (codex-runtime: `resolveCodexLevelPolicy`, fingerprint extraction,
  `updateNextTurn` applies the level from the next turn with persist-before-mutate and a per-turn
  snapshot `turnPermissionLevel`), 8q-3a mock fix (4 spec mocks). Reports (untracked):
  T\batch-8q-1-report.md, batch-8q-2a-report.md, batch-8q-3a-report.md, batch-8q-3a-mockfix-report.md.
- Reviews (untracked): T\security-review-8q-1.md APPROVE 8.5/10 (0 blocking/serious/moderate,
  4 minor). T\security-review-8q-3a.md APPROVE 8/10 with MODERATES to fix BEFORE the 8q-3a commit:
  M1 the `updateNextTurn` persist (`codex-context.ts:~803`) is not tracked by `this.persistence`
  and has no closed check after the await, so a close during it leaves the identity active and
  returns success from a closed context (`:924-946`); M2 turns started by a `turn/started`
  notification while idle (compaction; `:207-214`, `:395-402`) have no level snapshot, so the bridge
  falls back to the live level. M3 (sink/bridge disagreement) closes with 8q-3b. Minors: record in
  batches.md. I asked the team-leader to fix M1/M2 by resuming codex lane session
  `01a18858-0424-72f0-b5e5-7f1728b1f5a1`; UNKNOWN whether it started. Check `git diff` of
  codex-context.ts for a closed check and a snapshot on notification-started turns.
- A combined Wave 1 verify was running at handoff (pid 35136, codex-runtime, cli-agent-runtime,
  gateway-chat-bridge, agent-sdk, rpc-handlers; started 15:56:32Z). Its result is lost; re-run it.
- Modified files: agent-sdk `codex-app-server/` codex-read-only-command.ts + spec,
  codex-chat-approval-sink.ts + spec, codex-chat-adapter.spec.ts, codex-chat-turn-lifecycle.spec.ts;
  codex-runtime codex-context.ts, codex-execution-profile.ts + spec, codex-runtime.spec.ts,
  codex-runtime.types.ts; gateway-chat-bridge codex-gateway-adapter.spec.ts; rpc-handlers
  `chat/codex-host/` codex-chat-native-contract.spec.ts, codex-session-settings-record.ts,
  codex-saved-permission-level.ts (new) + spec (new); T\batches.md.

## Background work

- RUNNING: codex lane `8027c8c0...` (8q-3a type error + M1 + M2 fix; see UPDATE above). Do not
  edit or commit in W until it signals; read it with `ptah_agent_read` if its signal is missed.
- verify pid 35136 may still hold a slot: `node scripts/verify.mjs --status`.

## Next steps (in order)

1. State check: `git -C W status -sb`, `node scripts/verify.mjs --status`, `gh pr checks 823`.
   Confirm no lane edits W.
2. Finish Round 8q Wave 1: fix 8q-3a M1/M2 via a codex lane (+ specs: close during persist,
   snapshot for a notification-started turn). Verify in the background (timeout >= 90 min):
   `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/cli-agent-runtime,@ptah-extension/gateway-chat-bridge,@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers`.
   Commit per batch (8q-1, 8q-2a, 8q-3a + mock fix) with their reports and reviews; batches.md in
   the first commit. Known Windows-only failures: auth-providers lint `@nx/dependency-checks`;
   EPERM teardown in `translation-proxy.sdk.integration.spec.ts`; agent-sdk lint
   `session-query-executor.accounts.spec.ts:174,183`; flaky memory-curator coalesce spec.
3. Wave 2: 8q-3b (sink reads the turn level; identity store re-save) and 8q-2b (Codex profile uses
   the saved level through the helper; Electron supplies the reader; resume refusal reachable).
   Wave 3: 8q-3c (rpc-handlers specs for a level change on an open thread). Security review of
   8q-3b by a lane of a different vendor than the implementer; one code-logic review of the round
   by a lane. Round gate: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`,
   `npx nx run di-lint:lint`,
   `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.
   Push in the background; watch CI with `gh pr checks 823 --watch`.
4. Live run p8k (approved continuation of the p8 live test; Electron, gpt-6-sol, Manual, <=10 paid
   turns, settings.json backup + cmp restore, free CDP port; procedure in the e10bb860a handoff and
   T\live-test-p8j.md): reads with `-TotalCount`/`-Name` auto-accept; non-accept reason log; mode
   change on an open thread applies from the next turn (rollout policy changes); saved mode change
   + restart gives the D14a refusal text.
5. P9 (batches.md "Round P9"): 9b-2, 9b-3, 9b-4 (+ RoutingAgentAdapter reads the consumer at
   routing-agent-adapter.ts:94,100,112), 9b-5, 9b-5a (consumer-aware resume guard at
   workspace-provider-profile-resolver.ts:192 + gateway resume spec), 9b-6, 9b-7 (delete 9a
   classes). Then P10 + Removal B, P14 (incl. GAP-3), D9, P15 Removal A.

## Rules (unchanged; repeat to every lane)

CLAUDE.md applies. Scoped `npm run verify -- -p ...` only, in the background, timeout >= 90 min.
Never build/serve/e2e except the approved Electron live run. Never npm ci/install in a worktree.
No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`. Lanes never verify, commit, push or call
ptah_get_diagnostics; say so in the first lines of each lane task; deliverable paths absolute.
Never commit while any lane edits W. Commit in the foreground (commitlint scopes, subject <= 72,
body lines <= 100, no BOM, message via file + `git commit -F`, trailer
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); push in the background. No merge, force
push, history rewrite, branch deletion or worktree removal. Do not edit ~/.ptah/settings.json
(except the live-test backup/restore) or ~/.codex/config.toml. NEVER strip MCP. If another
worktree's Ptah Dev app holds the Electron lock, ask the user. Use `gh --jq`. Strip UTF-8 BOMs from
lane-written files. Relay each lane signal to whoever coordinates that lane.
