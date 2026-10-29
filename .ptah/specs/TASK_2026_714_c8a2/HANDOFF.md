# Session handoff — TASK_2026_714_c8a2 (session 27)

Written 2026-10-30. Replaces the session 26 handoff (commit 64fc85d47; read it with
`git show 64fc85d47:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`). The full Goal, PR table, older
open items, key-file list and Rules are in the session 24 handoff:
`git show 44e3b1102:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md` (all still valid). The Electron
live-test procedure is in `git show e10bb860a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md` and
T\live-test-p8j.md.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, DRAFT PR #823 https://github.com/Hive-Academy/ptah-extension/pull/823,
do not merge). T = `W\.ptah\specs\TASK_2026_714_c8a2\`.

**USER INSTRUCTION (still in force): use Codex and grok CLI lanes heavily and REPLACE Claude
subagents** for implementation, reviews and planning. Codex model `gpt-6-sol` only (NEVER
`gpt-6.1-terra`). **New in session 27 (user asked): rely more on Kimi Code to review grok work.**
Routing now: grok implements -> Kimi Code reviews (`ptahCliId: pc-10e5a6b5-b237-4c72-a213-3202bd30d1fe`,
`modelTier: "opus"`; fallback codex); codex implements -> grok reviews. Kimi limits are not
tracked; spot-check its line citations (its first two reviews were accurate). Limits at session 27
end: codex weekly ~21% (resets 2026-11-04 07:03 UTC), grok weekly ~36% (resets 2026-11-03 17:40
UTC), opencode AT LIMIT (monthly, resets 2026-11-04), Glm weekly 76%. The coordinator runs
verify, commit and push itself; lanes never do.

## Goal (short)

One Codex App Server runtime (`@ptah-extension/codex-runtime`) for Ptah main chat, gateways and
CLI lanes; then Removal B (P10, `@openai/codex-sdk` lanes) and Removal A (P15, Claude SDK + Codex
translation proxy for Codex main chat). Electron first. Native UI contracts identical to Claude's;
fix gaps only in the backend translation layer; no frontend Codex special case; no second proxy;
NEVER strip/revert/comment out MCP.

## Done in session 27

| Commit | What | Review | Verify |
| --- | --- | --- | --- |
| 90c3e95b7 | test(agent-sdk): settle queued gate waiters (CI shard 4/4 flake: `void queued` left 60 s real timers in internal-query specs; latent on main too) | grok APPROVE 9/10 | agent-sdk, codex-runtime PASS |
| 071b413c1 | test(codex-runtime): spec locks the sent wire level for idle notification turns (closes session-26 optional minor) | grok APPROVE 9/10 | PASS |
| 3a8bd572d | 9b-2 gateway gets the chat D14 mapping + async question card | codex APPROVE 9/10 | codex-runtime PASS |
| fe9ef25ff | 9b-3 dev override covers `chat`+`gateway` (`consumers` list, `codexDevRouteCovers`), gate per consumer, Electron `nativeCodexGateway` | grok REVISE 6/10 -> fixed -> APPROVE 9/10 (review-9b-3-fix.md) | codex-runtime, ptah-electron, agent-sdk, rpc-handlers PASS 18/18 |
| 0461b5dd4 | 9b-4 RoutingAgentAdapter/CodexChatAdapter route and gate by consumer; sink auto-accept flag (chat only) | grok APPROVE 8/10 | agent-sdk PASS |
| ca6580906 | 9b-5a consumer-aware native resume guard (auth-providers) | grok APPROVE 9/10 | PASS except known Windows noise (translation-proxy EPERM x4, dependency-checks lint) |
| e3ebac212 | 9b-5 gateway prompt parity: unroutable payload, 60 s deny window, Claude system-abort decline, lifecycle events; shared `buildSystemAbortPermissionMessage` + `UNROUTABLE_PERMISSION_TIMEOUT_MS` exported from agent-sdk | codex REVISE 7 -> REVISE 8 -> kimi APPROVE 9.5/10 | agent-sdk, rpc-handlers PASS |
| 00c21292e | 9b-6 `SdkPermissionHandler.publishPromptLifecycle`; export `resolveSessionRuntimeIdentity`; Electron binds `promptLifecycle` | grok APPROVE 9/10 | agent-sdk PASS; **ptah-electron NOT yet verified for this commit** |

Pushed: up to e3ebac212. **00c21292e is NOT pushed (branch ahead 1).** CI on 071b413c1: 19 pass,
4 skipping, 0 fail. CI on e3ebac212 at handoff: 13 pass, 4 pending, 0 fail (re-check).

Coordinator decisions (reversible):
- 9b-5 review finding "end-to-end adapter teardown spec" declined: covered link by link (adapter
  close -> sink.dispose -> cancelPrompt/dismiss -> timer cleared), same as the 8q-2b decision.
- Open minors (not fixed): review-9b-2.md 1 (gateway card spec does not assert turn/steer of the
  answer); review-9b-6.md 1 (Electron spec does not resolve the bridge listener). Plus the
  session-26 minors in batches.md Round 8q.

## In progress — Batch 9b-7 (gateway-chat-bridge), UNCOMMITTED in W

Implemented by grok (report T\batch-9b-7-report.md). Files: modified
`libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts` and `gateway-chat-bridge.spec.ts`;
new `gateway-chat-bridge.native.spec.ts`; deleted `codex-gateway-adapter(.spec).ts` and
`codex-gateway-approval-sink(.spec).ts` (D25). Not verified yet (the verify run was cut off by
the session end). Not reviewed yet: Kimi review lane running (see Background work).

Coordinator concern sent to the reviewer: `prepareTurn` calls `resolveExecutionProfile` WITHOUT
`existingIdentity`. A bound Claude session on a host that now resolves native gets
`providerProfile: undefined` on resume; a bound native session after a provider switch gets a
Claude decision. Likely fix: look up the bound session's identity (identity lookup) and pass it
as `existingIdentity`. Wait for the review verdict before deciding.

## Background work

- Kimi Code review lane `a706dbe4-053b-44ca-b4b9-2389acd29cc8` (CLI Session ID
  `ad6a2e53-5277-419b-8288-6bf00fe7f53c`), read-only review of 9b-7, deliverable
  T\review-9b-7.md. State: running at handoff. Its `<agent-lane-completed>` goes to the new session.
- No verify holds a slot from this session (the 9b-7 verify was stopped).

## Next steps (in order)

1. State check: `git -C W status -sb` (expect ahead 1 + the 9b-7 diff),
   `node scripts/verify.mjs --status`,
   `gh pr checks 823 --json name,bucket --jq '[.[]|.bucket]|group_by(.)|map({(.[0]):length})|add'`.
   If a check failed: `gh pr checks 823 --json name,bucket,link --jq '.[]|select(.bucket=="fail")'`.
2. Wait for the Kimi review signal; read T\review-9b-7.md. Defects go back to grok (fresh lane with
   the full defect list, `file:line`); max 2 revise rounds; final check by Kimi.
3. Verify 9b-7 + Electron (covers 00c21292e too), in the background, timeout >= 90 min:
   `npm run verify -- -p @ptah-extension/gateway-chat-bridge,ptah-electron`
   (read results from the Nx terminalOutputs file named in the output; plain grep filters lose them).
4. Commit 9b-7 (stage the 4 deletions, the 2 modified files, the new native spec, T\batch-9b-7-report.md,
   T\review-9b-7*.md), then push in the background (pushes 00c21292e too), then watch CI.
5. P9 phase gate: verify codex-runtime, cli-agent-runtime, gateway-chat-bridge, agent-sdk,
   rpc-handlers, auth-providers, ptah-electron; degradation-audit; di-lint; typecheck
   ptah-extension-vscode, ptah-cli, ptah-tui (the public `CodexDevRouteOverride` shape changed in
   9b-3). Then the P9 phase review on the combined diff `64fc85d47..HEAD` (code-logic + style):
   use lanes (codex and Kimi, other family than each implementer), not Claude subagents.
   Update batches.md Round P9 headings to COMPLETE with commits.
6. Live run p8k (approved continuation of p8; procedure in the e10bb860a handoff and
   T\live-test-p8j.md; Electron, gpt-6-sol, Manual, <=10 paid turns, ~/.ptah/settings.json
   backup + cmp restore, free CDP port). Add a gateway check now that P9 lands (DS1 covers gateway).
   If another worktree's Ptah Dev app holds the Electron lock, ask the user.
7. Then P10 + Removal B, P14 (incl. GAP-3: Codex chat gets the user's MCP servers from
   `~/.claude.json` via cli-agent-runtime mcp-directory/claude-user-mcp.reader.ts), D9, P15 Removal A.

## Rules (unchanged; repeat to every lane)

CLAUDE.md applies. Scoped `npm run verify -- -p ...` only, in the background, timeout >= 90 min.
Never build/serve/e2e except the approved Electron live run. Never npm ci/install in a worktree.
No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`. Lanes never verify, commit, push or call
ptah_get_diagnostics; say so in the first lines of each lane task; deliverable paths absolute.
Never commit while any lane edits W (read-only review lanes are fine). Commit in the foreground
(commitlint scopes, subject <= 72, body lines <= 100, no BOM, message via file + `git commit -F`,
trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); push in the background, and
not while a lane edits W (the pre-push build gate reads the working tree). No merge of the PR,
force push, history rewrite, branch deletion or worktree removal (merging main INTO the branch is
allowed). Do not edit ~/.ptah/settings.json (except the live-test backup/restore) or
~/.codex/config.toml. NEVER strip MCP. Use `gh --jq`. Strip UTF-8 BOMs from lane-written files.
`ptah_agent_spawn` resumes become fresh lanes after 10 min idle: always give full instructions.
Lane spec traps to repeat: no assignment to readonly mock properties (Object.defineProperty); no
bracket access to private members on Object.create/Object.assign objects; type callbacks
`() => void` when assigning a Promise `resolve`; no pending real timers; DevRouteOverride fixture
shape is `{ consumers: ['chat', 'gateway'], source: 'PTAH_CODEX_RUNTIME_DEV' }`.
