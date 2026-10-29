# Session handoff — TASK_2026_714_c8a2 (session 26)

Written 2026-10-29. Replaces the session 25 handoff (commit 0bd8beee4; read it with
`git show 0bd8beee4:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`). The full Goal, PR table, older
open items, key-file list and Rules are in the session 24 handoff:
`git show 44e3b1102:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md` (all still valid). The Electron
live-test procedure is in `git show e10bb860a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md` and
T\live-test-p8j.md.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, DRAFT PR #823, do not merge). T = `W\.ptah\specs\TASK_2026_714_c8a2\`.

**USER INSTRUCTION (still in force): use Codex and grok CLI lanes heavily and REPLACE Claude
subagents** for implementation, reviews (code-logic, security, style) and planning where possible.
Codex model `gpt-6-sol` only (NEVER `gpt-6.1-terra`). At session 26 end: codex weekly ~29%
(resets 2026-11-04 07:03 UTC), grok weekly ~25% (resets 2026-11-03 17:40 UTC), opencode AT LIMIT
(monthly, resets 2026-11-04), Glm unknown. The coordinator runs verify, commit and push itself;
lanes never do. Review by the OTHER family than the implementer (codex <-> grok).

## Goal (short)

One Codex App Server runtime (`@ptah-extension/codex-runtime`) for Ptah main chat, gateways and
CLI lanes; then Removal B (P10, `@openai/codex-sdk` lanes) and Removal A (P15, Claude SDK + Codex
translation proxy for Codex main chat). Electron first. Native UI contracts identical to Claude's;
fix gaps only in the backend translation layer; no frontend Codex special case; no second proxy;
NEVER strip/revert/comment out MCP.

## Done in session 26 — Round 8q COMPLETE (batches.md "## Round 8q" + "Round 8q close")

| Commit | What |
| --- | --- |
| 79a79c391 | 8q-1 bounded PowerShell read grammar + names-only reason log (from session 25) |
| 9c17cfa34 | 8q-2a one saved Codex level helper (from session 25) |
| 0bd8beee4 | 8q-3a live level change in the runtime; M1/M2 fixed; grok review APPROVE 9/10 |
| e2882f440 | 8q-3b approval sink reads `turnPermissionLevel`; codex review APPROVE 8/10 |
| 88b25e320 | 8q-2b Codex profile uses the saved level; Electron binds the reader; grok APPROVE 8/10 |
| dd9b76e00 | 8q-3c specs: live level change through the session controls |
| b13acd7bd | merge of main (fd2fcb9fe); `chat:continue` `enqueued: true` specs (fixed CI shard 3/4) |
| 3b415ac67 | round code-logic review finding 1 (serious) fixed: wire level for notification turns |

Round gate PASS: verify codex-runtime, cli-agent-runtime, gateway-chat-bridge, agent-sdk,
rpc-handlers, ptah-electron 24/24; degradation-audit; di-lint; typecheck ptah-electron,
ptah-extension-vscode, ptah-cli, ptah-tui 4/4.

Session 26 coordinator decisions (reversible, recorded in batches.md):
- 8q-2b: removed the lane's new `chat-session.service.spec.ts` (redundant with
  chat-session.native.spec.ts:677-705, did not compile). Reachability is covered link by link.
- Round finding 2 (moderate) ACCEPTED: a process exit between the identity persist and the chip
  save gives the D14a refusal on the next open; in-process failures roll back.

## Open items carried forward

- Minor (optional, small): add one codex-runtime spec "user turn sends level X, stage Y, idle
  notification turn snapshots X" (today removing `codex-context.ts:530` fails no spec;
  review-8q-fix-wire-level.md new finding 1).
- Minors recorded in batches.md Round 8q (not fixed): unbounded `-Raw`; stale open-time
  `profileFingerprint` on approval requests; session approval rules not scoped by level;
  `markInactive` failure during close leaves the new row active; getter after close returns the
  last level.
- Lane spec traps seen this round (tell every implementation lane): do not assign to readonly
  properties in mocks (use `Object.defineProperty`); do not call private members through bracket
  access on `Object.create`/`Object.assign` objects (types as `never`); type callbacks
  `() => void` when assigning a Promise `resolve`.

## State at handoff

- All work committed. The push of the session 26 commits runs/ran at the end of session 26 (see
  "Push" below). Check with `git -C W status -sb` (expect "up to date with origin").
- No lane runs. No verify holds a slot from this session.

## Next steps (in order)

1. State check: `git -C W status -sb`, `node scripts/verify.mjs --status`,
   `gh pr checks 823 --json name,bucket --jq '[.[]|.bucket]|group_by(.)|map({(.[0]):length})|add'`.
   If a check failed: `gh pr checks 823 --json name,bucket,link --jq '.[]|select(.bucket=="fail")'`,
   then `gh run view <run> --job <job> --log-failed | grep -E "FAIL|●|error TS"`. CI tests the
   merge with main, so a new main commit can break branch specs (as in session 26).
2. Optional: the minor spec above (one codex lane, grok review, verify codex-runtime).
3. Live run p8k (approved continuation of the p8 live test; Electron, gpt-6-sol, Manual, <=10 paid
   turns, ~/.ptah/settings.json backup + cmp restore, free CDP port; procedure in the e10bb860a
   handoff and T\live-test-p8j.md). Check: reads with `-TotalCount`/`-Name` auto-accept; the
   non-accept reason log; a mode change on an open thread applies from the next turn (rollout
   policy changes); a compaction after a mode change keeps the old policy until the next user
   turn; saved mode change + restart gives the D14a refusal text. If another worktree's Ptah Dev
   app holds the Electron lock, ask the user.
4. P9 (batches.md "Round P9"): 9b-2, 9b-3, 9b-4 (+ RoutingAgentAdapter reads the consumer at
   routing-agent-adapter.ts:94,100,112), 9b-5, 9b-5a (consumer-aware resume guard at
   workspace-provider-profile-resolver.ts:192 + gateway resume spec), 9b-6, 9b-7 (delete 9a
   classes `CodexGatewayAdapter`/`CodexGatewayApprovalSink`, D25). Re-check line anchors first:
   main was merged in b13acd7bd. Then P10 + Removal B, P14 (incl. GAP-3: Codex chat gets the
   user's MCP servers from `~/.claude.json`, user and project scope, stdio and HTTP, via
   cli-agent-runtime mcp-directory/claude-user-mcp.reader.ts), D9, P15 Removal A.

## Rules (unchanged; repeat to every lane)

CLAUDE.md applies. Scoped `npm run verify -- -p ...` only, in the background, timeout >= 90 min.
Never build/serve/e2e except the approved Electron live run. Never npm ci/install in a worktree.
No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`. Lanes never verify, commit, push or call
ptah_get_diagnostics; say so in the first lines of each lane task; deliverable paths absolute.
Never commit while any lane edits W. Commit in the foreground (commitlint scopes, subject <= 72,
body lines <= 100, no BOM, message via file + `git commit -F`, trailer
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); push in the background. No merge of
the PR, force push, history rewrite, branch deletion or worktree removal (merging main INTO the
branch is allowed). Do not edit ~/.ptah/settings.json (except the live-test backup/restore) or
~/.codex/config.toml. NEVER strip MCP. If another worktree's Ptah Dev app holds the Electron lock,
ask the user. Use `gh --jq`. Strip UTF-8 BOMs from lane-written files. `ptah_agent_spawn` takes
no `taskKind`/`routingSource` keys in this build.
