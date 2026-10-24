# Session handoff — TASK_2026_714_c8a2 (session 5)

Written 2026-10-24 at the user's request (session at 35.4M tokens). Replaces the session 4 handoff.
No lane, subagent or background command of this task is running. This session does NOT hold the
heavy-check slot: it is queued (717 holds it → 712 next → 714). Wait for "released" before any
heavy check.

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. The two current
paths (main chat = Claude Agent SDK + Codex translation proxy; lanes = `@openai/codex-sdk`) are
migration sources, retired only after proven parity and separate user confirmation (Removal A:
proxy, Removal B: codex-sdk lanes). Claude behavior stays unchanged. Electron first. No
runtime-selector UI. A visible refusal is not parity. Production stays disabled until the evidence
spike proves the required observations (`implementation-plan.md:262-270`).

## Git state

Worktree `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`, branch
`feat/codex-sdk-main-chat`, draft PR https://github.com/Hive-Academy/ptah-extension/pull/809.

- Local head `c9187f9d9`. Remote head is older (`d74295bdc`).
- **Six commits are local only** (two pushes failed: github.com:443 unreachable; api.github.com
  worked, per peer 718): `d22e61e1e`, `21f7f49fe`, `ce6dd5104`, `d432b55ee`, `cfb45cd73`,
  `c9187f9d9`. CI has not run on any of them.
- **Uncommitted (Batch 1k + docs), formatted with prettier, NOT yet nx-checked:**
  - code: `libs/backend/codex-runtime/tools/evidence-harness.ts`, `evidence-harness.spec.ts`
  - docs: `.ptah/specs/TASK_2026_714_c8a2/decisions.md`, `spike-runner.ts`, `HANDOFF.md`,
    `batch-1k-report.md`, `batch-1k-fixes-report.md`, `code-logic-review-batch-1k.md`,
    `code-logic-review-batch-1k-fixes.md`

## Spike results (model gpt-6-luna, bundled codex 0.155.1, copied auth only)

Turns: **15 of 20 used, 5 remain.** Bounds: 30000 per turn, 100000 cumulative per run.

| Observation | Status | Run |
|---|---|---|
| Command accept / deny (granular all-true + read-only) | Observed | 6e / 6f |
| Compaction | Observed | 6e |
| File-change accept, plan read-only boundary, auto-edit boundary, YOLO interrupt | Observed | 6h |
| MCP approval via `mcpServer/elicitation/request` | OPEN — 6h waited for a wrong method and broke the old 15000 bound; fixed in Batch 1k | — |
| Edited input via decline + `turn/steer` | OPEN — 6f/6g failed because developerInstructions leaked the plan; fixed in `d432b55ee` | — |
| Ask-level exec-policy read prompt | DROPPED by user decision (below) | — |

## User decisions this session (all in `decisions.md`)

1. Turn budget 20 total. Per-turn usage bound 30000 (cumulative 100000 unchanged).
2. Allow one marker read in the edit case.
3. "We need to get everything working as expected."
4. **Ask level = Codex granular (all true) + `read-only` sandbox, matching Claude Code and current
   Ptah ask.** Reads and other sandbox-allowed actions run without a prompt; writes, file changes,
   escalated commands and MCP tool calls ask first. The exec-policy read rule is not needed;
   `ask-read-rule` stays in the harness but is not run. This settles the granular adoption
   question for the core batch.

Context given to the user: granular is a Codex approval policy, not Ptah state. Ptah only answers
Codex's JSON-RPC approval requests with its own prompt UI; Codex enforces the sandbox. Nothing is
wired in production yet — the current lane builder hard-codes `approval_policy="never"`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-config.builder.ts:129`).
Ptah levels: `PermissionLevel` in `libs/shared/src/lib/types/model-autopilot.types.ts:20`.

## Batch 1k (done, approved, uncommitted)

- Event summaries: item type/status, MCP server/tool, error flag, startup status/name.
- MCP approval via `mcpServer/elicitation/request` (thread + turnId (null allowed) + server
  `marker` + approvalRounds 0; required fields only if all boolean, answered true); dead
  `item/mcpToolCall/requestApproval` path removed; `openai/form` modes dropped;
  `default_tools_approval_mode="prompt"` for the mcp case only (missing key in config/read → note,
  not throw); `USAGE_TURN_LIMIT = 30_000`.
- Review: REVISE 7/10 → lane fixed S1/S2 → re-review REVISE 8/10 for one spec assertion → fixed by
  orchestrator (config-wrong spec asserts on `String(failure)` + non-observed status). Jest 167/167.

## Run 6i plan (`spike-runner.ts`, already edited)

Cases: `schema-handshake`, `modified-input-schema`, `mcp-approval`, `ask-command-edit` = 2 planned
turns, `--turn-cap 3` (one steer slot), 2 of 5 turns in reserve. A failed gate stops later cases.

## Open problems / recorded, not fixed

- Edited input and MCP approval still unproved (run 6i).
- Experimental API dependency for granular approvals (`capabilities.experimentalApi=true`).
- Usage is observed, not enforced mid-turn; one-turn overshoot possible.
- Review leftovers: 1h M1 ("usage after terminal: not observed" can be false), one usage wait per
  case, 1h M3/M4 spec gaps, 1i paramKeys uncapped, 1k M4 (repeat message) and Minors, earlier
  1c–1f leftovers (see session 4 notes in git history of this file). Lint warnings: `max-lines`,
  `preserve-caught-error`, `no-useless-assignment`. Split the harness if it outlives the spike.
- Version drift: global codex 0.163.0, bundled 0.155.1; core must check the manifest pin.

## Peer coordination

- TASK_2026_712 (PR #808, not merged) owns until merged: agent-sdk `sdk-agent-adapter.ts`,
  `session-query-executor.service.ts`, `sdk-query-options-builder.ts`, `sdk-query-runner.service.ts`,
  `session-registry.service.ts`, `session-metadata-store.ts`, `session-quota-probe.service.ts`,
  `sdk-model-service.ts`, agent-sdk `di/register.ts`; rpc-handlers `chat-session.service.ts`,
  `chat-slash-command-router.service.ts`, `session-rpc.handlers.ts`, `chat-session.account-binding.spec.ts`,
  `chat/session/child-chat-session-host.adapter.ts`; cli-agent-runtime
  `session-children/session-spawner.{port,service}.ts`. Rebase on #808 before touching these.
  Migration 0059 is theirs; 714 uses 0060+.
- tsyringe: `{ useFactory: () => null }`, never `{ useValue: null }`.
- Heavy-check slot: coordinate with ListAgents + SendMessage. Current queue: 717 (Electron visual
  review) → 712 → 714. 712 and 717 promised to send "released" to this task. A new session has a
  new address: re-announce yourself in the queue. Send "released" after your push gate.
- Shared `node_modules`. Never `npm ci`/`npm install` in this worktree.

## Key files

Task folder `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/`:
`decisions.md`, `native-route-evidence.md`, `implementation-plan.md`, `spike-runner.ts`,
`spike-run-6*.{md,json}`, `batch-1*-report.md`, `code-logic-review-batch-1*.md`.
Code: `libs/backend/codex-runtime/tools/` (`evidence-harness.ts`, `evidence-harness.spec.ts`,
`evidence-cases.json`, `evidence-failure-notes.ts`, `evidence-frames.ts`).
Bundled binary: `D:/projects/ptah-extension/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe` (0.155.1).

## Next steps

1. Read this file and the last 8 rows of `decisions.md`. `git status` in the worktree.
2. ListAgents; re-join the heavy-check queue (717 → 712 → 714). Wait for "released".
3. With the slot:
   `npx nx run-many -t test typecheck lint -p codex-runtime --parallel=1 --output-style=static --skip-nx-cache 2>&1 | tail -40`
   (prettier already applied; rerun `npx prettier --write` on the changed files only if you edit).
4. Commit in the foreground, explicit paths (check `.commitlintrc.json`):
   - `fix(codex-runtime): approve mcp calls through elicitation requests` — harness + spec.
   - `docs(task-specs): record codex batch 1k and ask-level decision` — the docs listed above.
5. Push in the background (`git push`); if github.com:443 still times out, report it and keep the
   commits local. Send "released" to the peers. Then `gh pr checks 809` and watch CI.
6. Run 6i from the worktree root:
   `npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json .ptah/specs/TASK_2026_714_c8a2/spike-runner.ts --dry-run`
   then
   `npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json .ptah/specs/TASK_2026_714_c8a2/spike-runner.ts --run --binary 'D:/projects/ptah-extension/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe' --auth-source "$USERPROFILE/.codex/auth.json" --model gpt-6-luna --out 'D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/spike-run-6i.md'`
   After: `ls -d "$TEMP"/ptah-codex-evidence-*` must list nothing. Record turns and usage.
7. Update `native-route-evidence.md` and `decisions.md`, commit, push. Report the MCP and
   edited-input results to the user; ask before spending more than the 5 remaining turns.
8. Then team-leader decomposition of the core batch (ask = granular + read-only per decision 4),
   respecting the 712 claims.
