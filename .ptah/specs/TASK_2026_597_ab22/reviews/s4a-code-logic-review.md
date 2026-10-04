# Code Logic Review — `TASK_2026_597_ab22` (S4-a phase end: Batches 24, 30.2, 32, 33, 34)

Scope: `git diff c179f3eb5..HEAD -- . ':!.ptah'` (53 files). Read per file: lane resume gate, Codex rollout reader, manager diff (gate, `recordRequestContext`, `waitForAgents`) plus the existing `continueConversation`, `stopAgent`, `handleTimeout`, `handleExit` paths it depends on, `agent-wait.tool.ts`, `run-check.tool.ts`, `wait-tools-args.schema.ts`, both dispatcher diffs, `resolveSpoolRoot`/`findKnownWorkspaceFolder`, the namespace builder diff, the curator and trigger diffs, and the budget engine move (old `tool-result-budget.ts` at `c179f3eb5` against the new engine and wrapper). Batch reports 24, 30-2, 32, 33, 34 and plan component 14/15, R9.1/R9.2 were read. I did not re-run tests; the reports record scoped typecheck, lint and test passes.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 6 (2 fix-now)  |
| Failure modes found | 10             |

Score: the waits, the budget move and the WARN paths are sound and well bounded. The score is not 7 because `ptah_run_check` can report a verdict for the wrong checkout without saying which one it ran, and the resume gate swaps a resume for a thin handoff without telling the caller. It is not 5 because none of these corrupt state, and every new boundary validates its input.

## Five logic questions

### 1. How does this fail silently?

- `ptah_run_check` runs in `known[0]` when the caller's declared root is not an open workspace folder (`protocol-dispatcher.ts:1364` → `:3389`; matching is exact, `:3418-3433`). A lane in a git worktree under `.claude-worktrees/` gets PASSED/FAILED for the main checkout. The reply never names the cwd; only the log file does (`run-check.tool.ts:266`).
- The resume gate's `fresh` decision only reaches the output channel and the logger (`agent-process-manager.service.ts:363-373`). `SpawnAgentResult` has no field for it, so the orchestrator believes it resumed a lane that actually holds a 2,000-character brief.
- A curator pass that fails, or falls back to the placeholder, has already stamped the watermark (`memory-curator.service.ts:331`, before the async pass at `:251`). The next PreCompact within 15 minutes is skipped and logged as a normal "coalesced" skip.

### 2. What user action produces unexpected behaviour?

- Resuming a lane more than 10 minutes after its last turn (the common orchestrator rhythm) always starts a fresh lane (`lane-resume-gate.ts:151-156`). Doing it twice loses the original task (see M1).
- Running `/compact` by hand within 15 minutes of an auto-compaction is skipped. The `manual` trigger is not exempt (`memory-curator.service.ts:250`).
- `ptah.agent.waitFor(id, { timeout: 3_600_000 })` now gives up at 15 minutes (`agent-namespace.builder.ts:477`). The error message states the clamped value.

### 3. What input data produces a wrong answer?

- When a Codex rollout is missing or unreadable, the gate falls back to the streamed figure (`lane-resume-gate.ts:110-119`). That figure is the `turn.completed` sum (`agent-process-manager.service.ts:793`, and the comment above it says so). R9.1 says this figure "shall never be" used. A tool-heavy turn exceeds 60k, so the lane goes fresh.
- The handoff's "Original task" comes from `lane[0].info.task` (`:388`). For a lane that was itself a fresh handoff, that field holds only the follow-up message, because the record stores `request.task` (`:443`) and not the handoff.
- If the session being resumed is still running, the gate measures idle time from `startedAt` (`:351`). A lane that has run for more than 10 minutes is judged idle and goes fresh.

### 4. What happens when a dependency fails?

- Rollout read throws: the error is caught and the figure is labelled `estimate` (`lane-resume-gate.ts:124-131`). This is OK, apart from M3.
- Nx missing: a clear error is returned. Spawn error: reported with the log path. Log open failure: the check still runs and the reply says the log was not written. All OK.
- An Nx child that ignores the kill: the run settles after `KILL_SETTLE_MS` either way. When the MCP request is cancelled or the host exits, the child is not killed. On POSIX it is `detached` (`run-check.tool.ts:335`), so it survives the host.
- A lane whose adapter never settles its abort after an inactivity timeout never emits `agent:exited`. An `any` wait then runs to its own timeout. The result still reports the lane as ended (documented at `agent-process-manager.service.ts:1066-1068`).
- `readOutput` failure in `ptah_agent_wait`: the last lines are omitted and the status is still reported. OK.

### 5. What is missing that the requirements never mentioned?

- A way for the caller to learn that a resume became fresh, and the new `cliSessionId` to resume next time.
- A way to force a resume, or to opt out of the gate.
- Cancellation for the blocking calls: neither `waitForAgents` nor `runCheck` takes an `AbortSignal`.
- Retention for `.ptah/tmp/checks/*.log`: no pruning and no size cap, unlike the `mcp-out` spool.
- The resolved cwd in the `ptah_run_check` reply.

## Failure modes

### Wrong-tree check verdict

- Trigger: a lane works in a worktree or other folder that is not an open workspace folder, or the caller declares no root on a multi-root host.
- Symptom: PASSED or FAILED for the main checkout's code, with no hint of which tree was checked.
- Evidence: `protocol-dispatcher.ts:1364`, `:3378-3390`, `:3418-3433`; `run-check.tool.ts` summary (`:266`, `logLine`).
- Current handling: silent fallback to `known[0]`, a policy that was designed for spool files and reused here.
- Recommendation: resolve the root strictly for `run_check`. Use the declared root when it is (or is inside) a known folder, or the lane's `scopedWorkspaceRoot`. Otherwise refuse. Always print `cwd` in the reply.

### Silent fresh-instead-of-resume

- Trigger: a `resumeSessionId` spawn whose last request was over 60k tokens, or that has been idle more than 10 minutes.
- Symptom: the orchestrator sends "continue with step 3 as discussed" and gets a lane that holds only the brief. If the host has no record of the session (a Codex thread from an earlier host session), the brief reads "Original task: (not available)".
- Evidence: `agent-process-manager.service.ts:343-394`, `lane-resume-gate.ts:207-210`; `SpawnAgentResult` (`agent-process.types.ts:250`) has no field for it.
- Current handling: logged only.
- Recommendation: add `resumeDecision: { decision, reason, source }` to `SpawnAgentResult` and render it in the spawn reply. Consider refusing `fresh` when no record exists and asking the caller to pass `force_resume`.

### Original task lost on a second handoff

- Trigger: a lane goes fresh, then its new session goes fresh again.
- Symptom: the second handoff's "Original task" is the follow-up message, and the real original task is gone.
- Evidence: `agent-process-manager.service.ts:443` (record stores `request.task`), `:384-390` (only `task` gets the handoff), `:388`.
- Recommendation: on `fresh`, carry the original task forward. Store the resolved original task on the new record (for example `info.handoffOriginalTask`) and read that first.

### Failed curator pass suppresses the retry

- Trigger: a PreCompact curation throws (LLM or store error) or has no transcript.
- Symptom: memory from that compaction window is never curated if a second compaction comes within 15 minutes.
- Evidence: `memory-curator.service.ts:250`, `:331` (stamped before the pass); `.catch` at `:284-296` does not clear it.
- Recommendation: clear the watermark in the `.catch` and on the placeholder path, or stamp it only after `curate` resolves. Exempt `trigger === 'manual'`.

### Turn-sum fallback for Codex

- Trigger: rollout missing or unreadable for a Codex lane that has a streamed figure.
- Symptom: the per-turn sum is compared against 60k, so the lane goes fresh much more often.
- Evidence: `lane-resume-gate.ts:110-119`, `agent-process-manager.service.ts:793`.
- Recommendation: for Codex with no rollout, treat the figure as unknown (`tokens: null`) and decide on idle time only, or divide the sum by the turn's request count when that count is known.

### Orphaned Nx tree

- Trigger: the host reloads or exits, or the MCP client cancels, during `ptah_run_check`.
- Symptom: an Nx run-many keeps running (up to 15 minutes of work, or longer since the timer dies with the host) and holds the Nx daemon and cache.
- Evidence: `run-check.tool.ts:335`; `execute` has no abort path.
- Recommendation: track live check PIDs and kill them on dispose; accept an `AbortSignal` from the request context.

### Dangling wait after an execute_code timeout

- Trigger: `ptah.agent.waitFor(id)` inside `execute_code` with no timeout. The default is 15 minutes; `execute_code` stops at 30 s.
- Symptom: the listener and timer live on for up to 15 minutes per call. More than 10 at once triggers `MaxListenersExceededWarning`. The old 1-hour poll loop was worse, so this is not a regression.
- Evidence: `agent-namespace.builder.ts:477-480`, `agent-process-manager.service.ts:1036-1059`.
- Recommendation: default `waitFor` to a timeout at or below the `execute_code` budget, or pass an abort signal through.

### Missed turn end on quick continuation

- Trigger: a turn ends and the lane is continued within `GRACEFUL_EXIT_DELAY_MS`.
- Symptom: `continueConversation` clears `exitEmitHandle`, so `agent:exited` never fires for that turn. A waiter keeps waiting for the next turn.
- Evidence: `agent-process-manager.service.ts:1939-1953` and the `exitEmitHandle` clear in `continueConversation`.
- Recommendation: acceptable; document it, or have the waiter also subscribe to the status change.

### Ungated idle continuation

- Rated low risk. The SDK idle release is 5 minutes (`agent-process-manager-helpers.ts:80`), so the idle criterion can never apply to a live continuation. Only a lane over 60k continued within 5 minutes, or a host with the idle release set above 10 minutes, escapes. The cost is extra tokens; context is preserved.

### Ungated Ptah CLI resume (`spawnFromSdkHandle`)

- Rated low-to-moderate risk. Every Ptah CLI resume skips the gate (`agent-namespace.builder.ts:282-316`; batch-32 report deviation 3). Behaviour is correct and context is kept; only the cost goal of R9.1 is missed. The fix needs the gate before `registry.spawnAgent` in the namespace builder.

## Blocking issues

None.

## Serious issues

### S1. `ptah_run_check` checks the wrong tree on a root it does not recognise

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1364`, `:3389`
- Scenario: a worktree lane, or a caller that declares no root on a multi-root host.
- Impact: a false PASSED on code the lane never touched. Orchestrators gate commits on it.
- Fix: resolve the root strictly (as above), refuse when there is no match, and print the cwd in the reply.

### S2. The resume gate's `fresh` decision is invisible to the caller

- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:363-394`
- Scenario: any resume over 60k tokens or after 10 minutes idle. That is the common case.
- Impact: the orchestrator assumes full context and gives under-specified follow-ups. Codex threads this host holds no record of get "Original task: (not available)".
- Fix: return the decision in `SpawnAgentResult` and in the tool reply. Consider refusing `fresh` with no record unless forced.

## Moderate and minor issues

Moderate, fix-now (they lose data):

- M1. Original task lost on chained handoffs: `agent-process-manager.service.ts:388`, `:443`.
- M2. Curator watermark stamped before the pass, so a failure suppresses the retry, and manual compaction is coalesced too: `memory-curator.service.ts:250`, `:331`.

Moderate, not fix-now:

- M3. The Codex no-rollout fallback uses the `turn.completed` sum, against R9.1: `lane-resume-gate.ts:110-119`, `agent-process-manager.service.ts:793`.
- M4. `run_check` child is not killed on cancel or dispose, and is detached on POSIX: `run-check.tool.ts:335`.
- M5. `waitForAgents` cannot be cancelled. `waitFor` defaults to 15 minutes, which outlives `execute_code`: `agent-namespace.builder.ts:477`, `agent-process-manager.service.ts:1036-1059`.
- M6. The idle-continuation and Ptah CLI resume paths are ungated (R9.1 PARTIAL). Risk is rated above.

Minor:

- `waitFor` maximum is silently reduced from 1 hour to 15 minutes: `agent-namespace.builder.ts:477`.
- A quick continuation suppresses `agent:exited`, so a waiter misses that turn end: `agent-process-manager.service.ts:1939-1953`.
- Deliverable stat reports any error (for example EACCES) as MISSING. Absolute deliverable paths outside the workspace are stat'd, which reveals only their size: `agent-wait.tool.ts` `resolveDeliverable` / `statOrUndefined`.
- `.ptah/tmp/checks` logs are never pruned and have no size cap: `run-check.tool.ts:522`.
- `originalTask` is not capped in the handoff (only `finalText` is): `lane-resume-gate.ts:209`.
- Idle time for a resume of a still-running session is measured from `startedAt`: `agent-process-manager.service.ts:351`.
- Unverified: OpenCode `tokens.input` may exclude cache reads, which would understate context and let a large thread resume (`opencode-cli.adapter.ts:891`).

## Data flow

Resume spawn:

1. `doSpawn` resolves the CLI and adapter, validates the directory and runs the preflight. OK.
2. `gateResume` → `laneRecordsForSession` (all records, sorted by `startedAt`). OK. Restored records are included.
3. `lastActivityAt` = latest `completedAt ?? startedAt`. Gap: a running lane uses `startedAt`.
4. `evaluate`: Codex reads the rollout tail with 64 KiB → 1 MiB → 16 MiB windows; others use the streamed figure. Gap: the Codex fallback is the turn sum (M3).
5. Decision is logged. Gap: it is not returned to the caller (S2).
6. `fresh` drops `resumeSessionId` and the task becomes the handoff. Gap: the record stores the bare message (M1).
7. `doSpawnSdk` runs with the gated request. OK.

Wait:

1. Schema (ids 1-10 of at most 128 chars, timeout 0-900 s, strict). OK.
2. Classify each id as not_found, other_workspace, pending or ended, synchronously, so no event can be missed before the listener is attached. OK.
3. The listener and an unref'd timer are both removed in `finish`. OK.
4. Entries are built and the summary is capped at 4,000 chars. OK. The reply stays under the default budget, so the budget engine passes it through unchanged.

run_check:

1. Schema (pattern, leading dash refused, targets enum, deduplicated). OK. No argument injection: `shell:false`, an argv array, and `,`, spaces and `:` are excluded.
2. Root from `resolveSpoolRoot`. Gap: S1.
3. Log with `wx` and a sanitised name. OK.
4. Spawn, a timeout that kills the tree, a 10 s settle backstop. OK. Gap: no cancel or dispose (M4).
5. Summary clamped to 4,000 chars, tail limited to 400 lines of at most 300 chars. OK.

Budget engine: `applyToolResultBudget` → `applyOutputBudget` with the same budget lookup, the same hint precedence (`input.hint ?? TOOL_CONTENT_HINTS`), the same preserved keys, and the same log text (`[tool-result-budget] <tool> budget step failed with …`). The identity, reduce, outline, spool and plain-cut paths moved without change, and `tool-result-budget.spec.ts` is unchanged. Behaviour unchanged: OK.

F6-M1 / PR1-M1: `systemPrompt` is dropped with a WARN on both spawn branches. `effort` is bounded by `MAX_EFFORT_LENGTH` and a non-string throws before any side effect. Ptah CLI `effort` gets a WARN. `logger` is required, so no host can drop these silently. OK.

## Requirements fulfilment

| Requirement                                         | Status   | Gap                                                                                  |
| --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| R9.1 gate on resume (60k / 10 min)                  | PARTIAL  | Idle continuation and Ptah CLI resume ungated; decision not surfaced                 |
| R9.1 per-request figure, never the turn sum         | PARTIAL  | Codex no-rollout fallback uses the turn sum                                          |
| R9.1 handoff (message, original task, final text, files) | PARTIAL | Original task lost on a chained handoff; no record → "not available"           |
| R9.1 stale warning corrected                        | COMPLETE | —                                                                                    |
| R9.2 `ptah_agent_wait` blocking, ≤900 s, ≤4,000 chars | COMPLETE | No cancellation                                                                    |
| R9.2 `ptah_run_check` pattern, targets, shell:false, cwd = caller root | PARTIAL | cwd falls back to `known[0]`, not the caller root            |
| R9.2 full logs under `.ptah/tmp`                    | COMPLETE | No retention                                                                         |
| `waitFor` rewrite keeps the rejection contract      | COMPLETE | Timeout and unknown-id rejections kept; maximum lowered to 15 min                    |
| A7 curator PreCompact coalescing, per session, rekey, forget | COMPLETE | Stamped before success (M2); manual not exempt                              |
| Batch 24 engine move, byte-identical                | COMPLETE | —                                                                                    |
| F6-M1 / PR1-M1 WARN paths                           | COMPLETE | —                                                                                    |

Implicit requirements not addressed: the caller learning that a resume became fresh; cancellation of blocking calls; cleanup of check processes on dispose; retention of check logs.

## Edge cases

| Case                                    | Handled | How                                            | Concern                              |
| --------------------------------------- | ------- | ---------------------------------------------- | ------------------------------------ |
| Wait on unknown or other-workspace ids  | YES     | Reported per id, never waited on               | —                                    |
| Wait with duplicate ids                 | YES     | Set deduplication                              | —                                    |
| Wait timeout 0 / NaN                    | YES     | Immediate partial result                       | —                                    |
| Lane exits before the listener attaches | YES     | Synchronous classification                     | —                                    |
| Lane timed out, adapter never settles   | PARTIAL | Reported as ended at timeout                   | `any` cannot return early            |
| Quick continuation after a turn         | NO      | Exit emit cleared                              | Waiter misses that turn              |
| run_check `--help` / `a,b` / `x:y`      | YES     | Leading dash refused; pattern excludes them    | —                                    |
| run_check on an unknown root            | NO      | Falls back to `known[0]`                       | S1                                   |
| run_check host exit mid-run             | NO      | —                                              | M4                                   |
| Rollout torn last line                  | YES     | Skips to the previous `token_count`            | —                                    |
| Rollout over 16 MiB with no recent count | YES    | Returns null, falls back                       | M3 fallback figure                   |
| Chained fresh handoffs                  | NO      | —                                              | M1                                   |
| Curator pass fails                      | NO      | Watermark kept                                 | M2                                   |
| Curator session never ends              | PARTIAL | One small entry per session stays              | Negligible                           |
| Curator rekey onto an existing key      | YES     | Refuse-overwrite, `from` deleted               | —                                    |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM. S1 depends on what root worktree lanes declare in the MCP URL. If they declare a non-folder path the fallback applies; if they declare the host root, the main checkout is checked. Either way the worktree is not checked.
- Top risk: `ptah_run_check` returns PASSED for a checkout the lane never edited, and the reply does not say which checkout ran.
- What a robust implementation would add:
  - strict root resolution and the cwd in the `run_check` reply;
  - `resumeDecision` on `SpawnAgentResult`;
  - the original task carried through handoffs;
  - the curator watermark cleared on failure, with manual compaction exempt;
  - a null figure for Codex with no rollout;
  - an `AbortSignal` and dispose-time kill for waits and checks;
  - retention for check logs.
