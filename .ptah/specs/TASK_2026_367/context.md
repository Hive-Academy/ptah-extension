# TASK_2026_367 — Context

## User intent

> "Orchestrate a fix for the issues found in `tmp/logs/log.log`. Do not use CLI
> tools (antigravity, codex, ollama, claude cli). Implement proper fixes for each
> issue."

Task type: **BUGFIX**. Workflow: Research → Architect → Team-Leader → QA
(seven libs are affected, so an implementation plan is required before batching).

`cli_delegation: disabled` — user instruction. All implementation goes through
`Task` sub-agents (`backend-developer`, `frontend-developer`, reviewers,
`senior-tester`). Never call `ptah_agent_spawn` in this task.

## Source evidence

`D:\projects\ptah-extension\tmp\logs\log.log` — 2357 lines, Electron host,
workspace `D:\projects\property-hub`. Counts: DEBUG 1291, INFO 943, WARN 79,
ERROR 15. Three chat sessions (`12dddf72`, `83aca9e8`, `50653b50`) and one
tribunal run that spawned 12 CLI agents (4 codex, 4 antigravity, 4 ptah-cli
"ollama cloud"). All 12 agents exited with code 0.

## Defect clusters (each needs a root-cause fix)

### C1 — "ollama cloud" ptah-cli agent: stderr logged at ERROR, model rejection unverified (12 ERROR lines)

Per spawn (4 spawns), three stderr lines are logged at ERROR by
`PtahCliRegistry` (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`):

```
⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set …
[claude-code:unrecognized_model] {"model":"glm-5.2:cloud","query_source":"sdk"}
[claude-code:unrecognized_model] {"model":"deepseek-v4-flash:0731-cloud","query_source":"generate_session_title"}
```

Open questions for research (must be settled before design):

1. Is `unrecognized_model` benign (the claude CLI still forwards the model id to
   `ANTHROPIC_BASE_URL`), or does the CLI substitute a default model? The agents
   produced 500 segments / 868 stream events, so _something_ answered.
2. Should every child stderr line be logged at ERROR? Informational stderr
   (connector notice) should not be ERROR. Design a classifier or a level map.
3. Should the spawn strip `ANTHROPIC_API_KEY` for a non-Anthropic provider, or
   is it the intended auth carrier for the Anthropic-compatible proxy?

### C2 — Wrong tier in the spawn log line (log defect)

`ptah-cli-registry.ts:813-818` prints `effectiveTiers.sonnet` as "model" while
the spawn used tier `opus` → `glm-5.2:cloud`. The line must print the tier that
was actually resolved for this spawn.

### C3 — `mcpDirectory:connectOAuth` failure is swallowed into a success result (3 ERROR lines)

`libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts:741-761`.
Firecrawl (`https://mcp.firecrawl.dev`) publishes no OAuth authorization-server
metadata. The handler logs `error` then `RpcHandler` logs `succeeded`. The
webview (`libs/frontend/marketplace/src/lib/oauth-surface.component.ts:465`)
must receive a failure it can render, and the user must be told the server
needs an API key rather than OAuth. Check whether the frontend already reads a
`success:false` payload; if it does, the fix is the message, not the shape.

### C4 — Memory curator cap drops up to 91 % of a transcript (15 WARN)

`libs/backend/memory-curator/src/lib/memory-curator.service.ts:341`. Cap is
32,768 chars; the head+tail clip saw 9 % of a 366,540-char transcript. Options:
chunked curation (map over windows, then reduce), a larger cap that scales with
the resolved model's context window, or a middle-sampled clip. The architect
decides; a bare cap raise is not acceptable on its own.

### C5 — Session lifecycle

- `chat:abort` retried 3× on an already-ended session (`50653b50`), each time
  warning `Cannot end session - not found` and returning success
  (`session-control.service.ts:122`). The webview holds stale session state and
  loops. Fix both sides: backend returns a distinguishable "already ended"
  result, frontend stops retrying on it.
- `Interrupt failed for session …: {}` (`session-control.service.ts:228`) —
  the error is serialized as `{}`. Serialize `name`, `message`, `stack`.
- `content_block_start but no active message for context: root` (5 WARN,
  `stream-event.transformer.ts:286`). A content block arrives before
  `message_start`. **Overlaps TASK_2026_366** (in_review, uncommitted in this
  working tree, same transformer family). See "Overlap" below.

### C6 — Harness sync

- Preflight timed out 8 / 8 times at `budgetMs: 1500`
  (`harness-preflight.service.ts:149`). The budget never suffices in this
  workspace, so the preflight does no work. Either measure why it is slow
  (hashing?) and make it cheaper, or make the budget adaptive / skip when the
  last full pass is fresh.
- `Reconcile finished with gaps`: expected 31, found 19, missing 12, foreign 19,
  `blocked: 12` unchanged since the last full pass
  (`harness-reconciler.service.ts:815`). Twelve items never converge. Find out
  what blocks them and either unblock or stop counting them as "missing".
- PulseMCP registry returns `410 Gone` (`[Harness] pulsemcp registry search failed`).
  The endpoint is retired. Remove the source or point it at the new URL; do not
  keep a permanently-degraded source.

### C7 — Diagnostics quality

- Agent spawn stalls the Electron main loop for 2–3 s (`[event-loop] lag`
  max 2923 ms, each immediately after `ptah_agent_spawn`). Find the synchronous
  section in `AgentProcessManager` / adapter resolution / plugin path
  resolution and move it off the main thread or make it async.
- `SubagentRegistryService.setTaskId` → `Record not found` 7/7 times; the
  `agentId` fallback recovers every one. The `taskId` arrives before
  `SubagentStart` registers the record. Make the primary path handle the
  ordering (buffer the taskId, or register on first sight).
- Double-encoded em dash in source strings (`SDK options built â€” launching query`,
  `sdk-query-runner.service.ts:267`). 68 source files carry the corruption; the
  console mirror is repaired by `console-text.ts` (TASK_2026_354) but the
  file-backed output channel is not. **Scope decision pending** (see checkpoint).

Out of scope: `[MCP] slow tool` for browser tools (page-bound, and the warning
code moved into `slow-tool-warning.ts` on the TASK_2026_362 branch).

## Overlap with TASK_2026_362 (worktree `.claude-worktrees/native-loop`, branch `feat/native-agent-loop-pi-ai`)

Files 362 changes that this task could touch:

| 362 file                                                                                                       | This task                                                                                                    |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `libs/backend/vscode-lm-tools/**/protocol-dispatcher.ts`, `slow-tool-warning.ts`, `http-mcp-server.service.ts` | Do NOT touch. `[MCP] slow tool` is out of scope.                                                             |
| `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`, `di/register.ts`, `index.ts`                       | Not touched by any cluster.                                                                                  |
| `libs/backend/rpc-handlers/**/session-rpc.handlers.ts`, `config-rpc.handlers.ts`, `chat-session.service.ts`    | Not touched. C3 is `mcp-directory-rpc.handlers.ts`. C5 abort is `agent-sdk` session-control + frontend chat. |
| `libs/shared/**` (provider / rpc-chat types)                                                                   | C3 may touch `mcp-directory.types.ts` only.                                                                  |
| 2 of the 68 mojibake source files                                                                              | Exclude those 2 from any sweep.                                                                              |

Verdict: **no direct file conflict** if the rules above hold. The real overlap
is TASK_2026_366 (assistant-message transformer, uncommitted in the main
working tree), not 362.

## Decisions (Checkpoint 0, 2026-09-02)

- `cli_delegation: disabled`
- **C5 transformer warning**: handled in 367, but only after 366 landed. The
  user committed 366 first (`fix(agent-sdk,shared): suppress empty assistant
message envelopes`), so 367 branches from that commit and the transformer
  fix is a LATE batch that builds on the committed 366 state.
- **Mojibake sweep**: repair 66 source files; skip the 2 also changed on
  `feat/native-agent-loop-pi-ai` (TASK_2026_362). String literals only.
- **Work location**: main working tree, new branch `fix/log-defects-367`
  created from the 366 commit on `chore/normalize-husky-line-endings`.
- **Untracked `.ptah/specs/TASK_2026_001/`** was found in the tree. Not created
  by this task, not staged. Left for the user to inspect.

## Research outcome — harness report (research-report-harness.md)

- **C6 blocked set**: NOT a defect. `blocked = missing ∩ foreign` is the
  documented mechanism (TASK_2026_306); the consent-dialog UI (Batch 9 of that
  task) is the only thing outstanding. No change in 367. Reclassifying
  `blocked` out of `missing` is the documented WRONG fix.
- **C6 preflight**: the budget is a real cancellation. 8/8 timeouts coincide
  with the 12-agent spawn burst. Fix: coalesce concurrent `ensure()` calls per
  workspace root (one in-flight promise) and count any recent pass toward the
  throttle. Do not raise the budget.
- **C6 PulseMCP**: `v0beta` is dead (410). `v0.1` is a paid, key-gated B2B
  API. Fix: remove `PulseMcpRegistrySource` and its files; aggregate search
  continues on official registry + Smithery.
- **C3 OAuth**: the failure already reaches the UI (`success:false` +
  `error`). The defect is UX only. Fix: named `OAuthDiscoveryError` → typed
  `reason: 'no-oauth-discovery'` on the result → UI hint "this server needs an
  API key", plus a debounced discovery probe before Connect. The RpcHandler
  "succeeded" line is transport-level and stays.
- **C4 curator cap**: chunked map/reduce curation, with tool_result/tool_use
  compression per window and a max-windows budget guard. Pattern source:
  `skill-synthesis/.../transcript-window.reader.ts` (fork vs. promote to a
  shared lib is an architect decision; the two libs are sibling leaves).

## Research outcome — spawn-runtime report (research-report.md)

- **C1 stderr**: the three lines are benign CLI diagnostics. `ollama-cloud`
  carries `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`; `buildSafeEnv` never
  forwards the host `ANTHROPIC_API_KEY`. `unrecognized_model` is a stderr-only
  notice, the request still goes out with the given id. Nothing to strip.
  Fix: stop the blanket `logger.error` at `ptah-cli-registry.ts:728-732`;
  extract the regex classifier duplicated in antigravity/opencode/pi-cli/
  copilot-sdk adapters into one shared helper and use it in all 5 sites
  (error-match → warn, else debug).
- **C2**: `ptah-cli-registry.ts:813-818` recomputes `effectiveTiers?.sonnet`.
  Reuse the `tier`/`model` locals from `:613-621`, delete the recomputation.
- **C7 lag**: synchronous `child_process.spawn` (`CreateProcessW` on Windows,
  cost ∝ binary size). `agent-sdk` already has `OffThreadProcessSpawner`
  (TASK_2026_341) but it is not exported from the public barrel and
  `cli-agent-runtime` never uses it: `cli-adapter.utils.ts` `spawnCli` /
  `probeCliVersion`, the 4 adapter call sites, and `PtahCliRegistry`'s
  `queryFn({...})` (no `spawnClaudeCodeProcess`). Architect decides: export
  the class, or a structural port like `HARNESS_PREFLIGHT_TOKEN`. Companion:
  dedupe the double `resolvePluginPaths` per spawn.
- **C7 race**: `task_started` (stream) fires before `SubagentStart` (hook) by
  construction. Fix: `pendingTaskIds` buffer in `SubagentStateStore` mirroring
  `pendingTeammateNames` (`markPendingTaskId` on miss in `setTaskId`,
  `consumePendingTaskId` in `register()`), same lazy cleanup.

## Execution model change (user, 2026-09-02 22:20)

User reversed the earlier decision: **use CLI agents, not Task sub-agents**,
chosen by task complexity. `cli_delegation: enabled`. Roster from
`ptah_agent_list` this session:

| Agent                                                                                   | Kind       | Use for                                                                                                        |
| --------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `claude cli` (ptahCliId `pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d`, Claude subscription) | ptah-cli   | architecture plan (opus), the heavy batches: C4 chunked curation, C7a off-thread spawn, C3 OAuth (opus/sonnet) |
| `antigravity`                                                                           | system CLI | medium batches: C1 classifier, C6a preflight coalesce, C7b pending buffer, C5a/C5b                             |
| `ollama cloud` (ptahCliId `pc-85830910-3d81-4248-84c1-4fa52752dd19`)                    | ptah-cli   | mechanical batches: C2 log line, C6b PulseMCP removal, mojibake sweep (sonnet/haiku)                           |
| `codex`                                                                                 | system CLI | not requested by the user; unused                                                                              |

The interrupted `software-architect` sub-agent (no file written) is abandoned;
the plan is re-issued to `claude cli`.

**Working-tree guard for every CLI agent**: the user has uncommitted 366
follow-up edits in `assistant-message.transformer.ts`, `claude-sdk.types.ts`,
`content-block-contract.spec.ts` and a new
`apps/ptah-electron-e2e/src/specs/chat/empty-assistant-envelope.spec.ts`.
No agent may touch those four files, run `git add -A`, `git stash`, or commit.

## Plan landed (claude cli, opus) — implementation-plan.md, 2026-09-02 23:03

12 batches in 4 waves + 1 deferred. Complexity ratings drive executor choice:

| Wave         | Batches                                                                                                                                                                                                           | Executor by rating                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1 (parallel) | B1 stderr classifier + spawn log (medium), B2 preflight coalesce (medium), B3 PulseMCP removal (mechanical), B4 chunked curation (heavy), B5 pendingTaskIds (mechanical), B6 Logger error args + C5a-now (medium) | heavy → claude cli opus, medium → antigravity, mechanical → ollama cloud |
| 2 (parallel) | B7 OAuth reason + probe (heavy), B8 off-thread SDK spawn in PtahCliRegistry (medium)                                                                                                                              |                                                                          |
| 3            | B9 off-thread spawnCli/probeCliVersion (heavy, descope candidate), B10 synthesized message_start (medium, LATE)                                                                                                   |                                                                          |
| 4            | B11 mojibake sweep (mechanical, alone, last)                                                                                                                                                                      |                                                                          |
| deferred     | B12 C5a `alreadyEnded` wire field — BLOCKED: `rpc-chat.types.ts`, `agent-adapter.types.ts`, `chat-session.service.ts` are all on the 362 branch                                                                   |                                                                          |

New scope facts from the plan: C5a is half-blocked by 362 (see B12); the
`resolvePluginPaths` dedupe is dropped with evidence; codex spawn lag is out
of scope (in-process SDK); a second mojibake family (right arrow, 122
occurrences) was found and included; C5b root cause is `Logger` itself
(`serializeArgs` is dead code), not the call site.

## Outcome (2026-09-03)

Fifteen commits on `fix/log-defects-367`, one per batch or review fix (see
`batches.md` commit log). Every log cluster is closed except the two items
that are blocked on TASK_2026_362 (`future-enhancements.md`). Execution model:
CLI agents chosen by complexity (claude cli opus for heavy, antigravity for
medium, ollama cloud sonnet for mechanical), codex as the independent reviewer
of every antigravity batch and of the two heavy claude cli batches. The
reviews found one HIGH each in waves 1 and 2 (session-scoped abort dedupe;
second envelope after a synthesized message_start); both were fixed and
re-reviewed before commit. Status: `in_review`.

## Research split (parallel, disjoint deliverables)

- `research-report.md` — spawn runtime: C1, C2, C7 (lag + registry race)
- `research-report-harness.md` — C3, C4, C6
