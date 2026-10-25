# Session handoff — TASK_2026_714_c8a2 (session 6)

Written 2026-10-24. Replaces the session 5 handoff. No lane, subagent or background command of
this task is running. Work is PAUSED by user decision until PR #808 (TASK_2026_712) merges.

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. The current
paths (main chat = Claude Agent SDK + Codex translation proxy; lanes = `@openai/codex-sdk`) are
migration sources, retired only after proven parity and separate user confirmation (Removal A:
proxy, Removal B: codex-sdk lanes). Claude behavior stays unchanged. Electron first. No
runtime-selector UI. Production stays disabled until the parity gate passes.

## Git state

- Worktree `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`, branch
  `feat/codex-sdk-main-chat`, PR https://github.com/Hive-Academy/ptah-extension/pull/809 (draft).
- Head `dc8c6a98b`, pushed; local = origin. 83 commits ahead of `main`.
- Last full CI (head `abb098133`): 19 pass, 3 skipped, 0 fail (incl. all electron-e2e shards).
- The worktree has a `node_modules` junction to the main checkout (created this session;
  `jest.preset.js` maps `marked` by absolute path). Remove it with `cmd //c rmdir node_modules`
  before `git worktree remove`. Never `npm ci`/`npm install` here.
- Line-ending-only diffs in `batch-1b/1c/1h-fixes/1k` reports are not task changes.

## User decisions this session (all in `decisions.md`)

1. Heavy checks: up to 3 concurrent scoped checks machine-wide (announced to all peers).
2. Codex edited input = T3 Code parity: no native edit; decisions accept / acceptForSession /
   decline / cancel; "edit" = decline + follow-up message.
3. Spike budget raised to 35 turns. **27 used, 8 remain.** Bounds 30000 per turn, 100000 per run.
4. Run 7c (Always Allow different-command step, ~92k) skipped; bounds unchanged.
5. **Wait for PR #808 to merge, then rebase on `main` and continue P5–P8, 3b.1, 9b, 10b/10c.**

## Done (all committed, reviewed by Claude, implemented by Codex lanes)

- P2 core `@ptah-extension/codex-runtime`: contracts, validator (all 82 pinned notifications
  accepted), version/digest pin, process (env allowlist, verified CODEX_HOME), profile builder,
  permission policy + rule store, approval bridge, event translator, runtime/context (steer,
  interrupt, compact watchdog 120 s), usage client, parity gate, lazy gated DI. Two review rounds.
- P3 2c (legacy lane reads auth from its CODEX_HOME). P4 3a/3c/3d (per-home auth owner, auth
  operation context, proxy policy; real auth.json shapes fixed), 3b partial (reader home supplier;
  legacy usage service refuses explicit homes).
- 9a gateway adapter + approval sink (request-bound replies, own child container, gated open).
- 10a lane profile + events (required permission level, requirement acknowledgement).
- Host build tsconfigs (electron, cli, tui) map `@ptah-extension/codex-runtime`.

## Evidence (native-route-evidence.md)

Observed: command accept/deny, file change, plan/auto-edit/YOLO boundaries, compaction, MCP
approval (elicitation), different-home and same-home isolation, native exact-command session
grant, resume, profile inputs (instructions, effort, stdio MCP), usage semantics (`last` = one
request, `total` = thread cumulative; a command turn = 2 requests, ~24–38k).
Unproved (gate stays disabled): Always Allow different-command prompt and Ptah rule-store scope,
history/rollback (`thread/rollback` → -32600), file rewind, subagents (schema absent), remote MCP,
packaged binaries, full access. The ledger in `codex-parity-gate.ts` still needs a reviewed
update to these results.

## Open items

- Parity-gate ledger update (code, needs review).
- Batch 1n replay spec does not reproduce the real four-notification breach; round estimates
  undercount command turns.
- Deferred P2 items (decisions.md "P2 open items"): raw Runtime token exported, extraEnv contract,
  rule-store pruning, silent MCP accept->decline, excludeSlashTmp; 3b findings 2/3; 9a host must
  call `close()` and reopen after a non-terminal abort.
- `translation-proxy.sdk.integration.spec.ts` fails locally on Windows (EPERM teardown), not CI.

## Peer coordination

- TASK_2026_712 PR #808 (open, review required) owns: agent-sdk `sdk-agent-adapter.ts`,
  `session-query-executor.service.ts`, `sdk-query-options-builder.ts`, `sdk-query-runner.service.ts`,
  `session-registry.service.ts`, `session-metadata-store.ts`, `session-quota-probe.service.ts`,
  `sdk-model-service.ts`, agent-sdk `di/register.ts` and `index.ts`; shared `index.ts`,
  `agent-adapter.types.ts`; auth-providers `index.ts`, `di/register.ts`, `register-providers.ts`,
  `provider-owner.resolver.ts`, `package.json` (714 added one non-adjacent line), quota files;
  rpc-handlers chat files; cli-agent-runtime `cli-adapter.interface.ts`, `di/register.ts`,
  session-children spawner. Migration 0059 is theirs; 714 uses 0060+.

## Next steps (after #808 merges)

1. `git fetch && git rebase origin/main` in the worktree; resolve conflicts; scoped checks for
   every touched project; push (normal push, no force unless the user approves).
2. Team-leader Mode 2 for the post-#808 phases: 3b.1, P5 (5a–5c), P6, P7, P8 (8c needs a Claude
   frontend implementer + Codex reviewer + Electron visual review), 9b, 10b, 10c.
3. Reviewed update of the parity-gate ledger with the 7a2–7f results.
4. Ask the user before spending the remaining 8 spike turns (history/rollback, Always Allow
   different command, remote MCP).
