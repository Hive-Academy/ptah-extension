# Session handoff — TASK_2026_714_c8a2 (session 28)

Written 2026-10-30. Replaces the session 27 handoff (commit 3a2d13f6c; read it with
`git show 3a2d13f6c:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`). The full Goal, PR table, older
open items, key-file list and Rules are in the session 24 handoff:
`git show 44e3b1102:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md` (all still valid). The Electron
live-test procedure is in `git show e10bb860a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`
(section "Electron live-test procedure (run from W)") and T\live-test-p8j.md.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, DRAFT PR #823 https://github.com/Hive-Academy/ptah-extension/pull/823,
do not merge). T = `W\.ptah\specs\TASK_2026_714_c8a2\`.

## Goal (short)

One Codex App Server runtime (`@ptah-extension/codex-runtime`) for Ptah main chat, gateways and
CLI lanes; then Removal B (P10, `@openai/codex-sdk` lanes) and Removal A (P15, Claude SDK + Codex
translation proxy for Codex main chat). Electron first. Native UI contracts identical to Claude's;
fix gaps only in the backend translation layer; no frontend Codex special case; no second proxy;
NEVER strip/revert/comment out MCP.

User routing instruction (standing): use Codex (model `gpt-6-sol`, never `gpt-6.1-terra`), grok and
Kimi Code CLI lanes heavily and REPLACE Claude subagents for implementation, reviews and planning.
grok implements -> Kimi Code reviews (ptahCliId `pc-10e5a6b5-b237-4c72-a213-3202bd30d1fe`,
modelTier opus; fallback codex); codex implements -> grok reviews. Check `ptah_agent_list` first.
The coordinator runs verify, commit and push itself.

## Done in session 28 (Round P9 closed)

| Commit | What | Review | Verify |
| --- | --- | --- | --- |
| 3a2d13f6c | 9b-7 native gateway turns (one runtime decision, bound identity, native resume without fallback, D14a, D25 deletions) | Kimi REVISE x3 -> APPROVE 10/10 | gateway-chat-bridge, ptah-electron 12/12 |
| 99a49b4e8 | 9c P9 review fixes: failed native terminal -> `runtime-failed` + `webviewReported` marker (gateway failure reply, broadcaster logs/Sentry without duplicate card), interrupted keeps `cancelled`; divergent/empty final text = one `source:'complete'` text_delta; gateway `pumpStream` reconciles per (messageId, blockIndex), orders by `message_start`, appends once in `finally`; rejected approval reply publishes `aborted`; shared `legacyClaudeSessionRuntimeIdentity`; `CodexChatAdapterError` in leaf `codex-chat-adapter-error.ts`; named sink options | Kimi + grok per sub-batch (T\review-9c-*.md), coordinator bounded fixes | agent-sdk, rpc-handlers, gateway-chat-bridge, ptah-electron 18/18; typecheck vscode/cli/tui PASS |
| 8ab29a433 | 9c-3 behavior-preserving splits: `codex-chat-approval-presentation.ts` (host ports 748 -> 450 lines); `gateway-turn-text.ts`, `gateway-turn-preparation.ts`, `gateway-native-resume-policy.ts` (bridge 1357 -> 1104) | grok REVISE (2 compile fixes by coordinator); Kimi APPROVE 10/10 | rpc-handlers, gateway-chat-bridge, ptah-electron PASS |
| 645044be7 | fix: vscode-core host-attention ingress guard (emission must be a direct `webviewManager` call; port renamed, guard list updated) — CI shard 1 had failed on 8ab29a433 | — | rpc-handlers, vscode-core 6/6 |

P9 phase gate (session 28, before 9c): codex-runtime, cli-agent-runtime, gateway-chat-bridge,
agent-sdk, rpc-handlers, ptah-electron, degradation-audit PASS; auth-providers only known Windows
noise (translation-proxy EPERM x4, dependency-checks persistence-sqlite); typecheck
ptah-extension-vscode, ptah-cli, ptah-tui PASS.

Phase reviews: T\code-logic-review-p9.md (codex REVISE 5/10) and T\code-style-review-p9.md (Kimi
REVISE 6/10); all findings fixed in 9c except logic finding 3, DISPUTED (recorded in batches.md
Batch 9c and commit 99a49b4e8): a bound gateway session without runtime metadata resolves to the
legacy Claude identity, the same rule as the chat path `storedChatRuntimeIdentity`; native sessions
always persist runtime metadata.

Pushed: all, head **645044be7**, branch in sync with origin. **CI on 645044be7: all checks pass or
skip, 0 fail.** batches.md: Round P9 and batches 9b-2..9b-7, 9c marked COMPLETE.

## In progress

Nothing. Worktree clean.

## Open problems and decisions

- Lesson: refactors that move a `*_REQUEST` webview emission must keep the direct
  `webviewManager...broadcastMessage(` shape and update the list in
  `libs/backend/vscode-core/src/api-wrappers/host-attention-ingress.spec.ts`; include
  `@ptah-extension/vscode-core` in verify when such files move.
- New specs in gateway-chat-bridge that import `@ptah-extension/agent-sdk` need
  `import 'reflect-metadata';` first (tsyringe).
- Behavior change accepted in 9c: a gateway watchdog timeout now sends only the timeout reply
  (partial text is no longer appended after cancellation).

## Key files

- `W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-events.ts` — native event projection (terminal failure, complete-source final text).
- `W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-turn-stream.ts` — turn generator and detached drain.
- `W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter-error.ts` — error class, `webviewReported` marker guard.
- `W\libs\backend\rpc-handlers\src\lib\chat\streaming\chat-stream-broadcaster.service.ts` — suppresses duplicate CHAT_ERROR for webview-reported errors.
- `W\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-approval-presentation.ts` — Codex approval cards, deny timers, lifecycle publish.
- `W\libs\backend\gateway-chat-bridge\src\lib\gateway-chat-bridge.ts` (+ `gateway-turn-text.ts`, `gateway-turn-preparation.ts`, `gateway-native-resume-policy.ts`) — gateway turns.
- `T\batches.md` — plan; next unfinished phase starts at "# Phase P10".

## Background work

None. No lane, child session or verify slot from this session is running.

## Next steps (in order)

1. State check: `git -C W status -sb` (expect clean, in sync), `node scripts/verify.mjs --status`,
   `gh pr checks 823 --json name,bucket --jq '[.[]|.bucket]|group_by(.)|map({(.[0]):length})|add'`.
2. Live run p8k (approved continuation of p8; procedure in the e10bb860a handoff and
   T\live-test-p8j.md; Electron, Codex model gpt-6-sol, approval mode Manual, <=10 paid tiny turns,
   `~/.ptah/settings.json` backup into a NEW `%TEMP%` folder + `cmp` restore (mandatory even on
   failure), free CDP port, `PTAH_CODEX_RUNTIME_DEV=1`). Check: streaming text, a corrected
   final, a failed turn (one error card, idle), a user stop, a Manual approval card, and a gateway
   check now that P9 landed (DS1 covers gateway) if a gateway is configurable locally. If another
   worktree's Ptah Dev app holds the Electron lock, ask the user. Write T\live-test-p8k.md; commit
   it (scope `task-specs`).
3. Then P10 + Removal B (T\batches.md "# Phase P10": Batch 10b App Server lane adapter onward), P14
   (incl. GAP-3: Codex chat gets the user's MCP servers from `~/.claude.json` via cli-agent-runtime
   mcp-directory/claude-user-mcp.reader.ts), D9, P15 Removal A. Per batch: lane implements, other
   family reviews, coordinator verifies (`npm run verify -- -p <projects>` in the background,
   timeout >= 90 min; include each host that depends on a changed shared lib), commits, pushes in
   the background, watches CI with `gh --jq`.

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
bracket access to private members on Object.create/Object.assign objects; Promise resolves via
`new Promise<void>((resolve) => ...)`; no pending real timers; no excess properties in typed
object literals; `import 'reflect-metadata';` first in specs that load tsyringe; DevRouteOverride
fixture shape is `{ consumers: ['chat', 'gateway'], source: 'PTAH_CODEX_RUNTIME_DEV' }`.
Kimi limits are not tracked; spot-check its citations. Revise cap: 2 lane rounds, then one bounded
coordinator correction plus an independent review.
