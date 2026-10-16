# Code Logic Re-Review — `TASK_2026_646_136a`, phase P6 fix round (Batches 38a, 38b)

Reviewer family: Anthropic. Fix implementer: codex (OpenAI) lanes plus small orchestrator corrections (decisions #101, #103; weaker-evidence note applies to those lines).

Scope: only commits `149440c89` (38a) and `d8675a544` (38b), read at the commit with `git show <sha>:<path>`. I read the changed source in full around each change, the neighbouring code each change depends on, and the spec cases the reports name. I did NOT re-run Nx, Jest, tsc, lint, build or `ptah_get_diagnostics` (a heavy build is in flight); the orchestrator's results in the Batch 38a/38b headers of `batches.md` are taken as given. I ran two throwaway Node scripts (outside the repo, `/tmp`) that call the repo's own `gpt-tokenizer` to measure a token count; nothing was written to the worktree.

## Summary

| Metric                  | Value                                                           |
| ----------------------- | --------------------------------------------------------------- |
| Overall score           | 7/10                                                            |
| Assessment              | APPROVED (with three small follow-ups recorded below)           |
| Original findings       | S-1 CLOSED, S-2 PARTIAL, S-3 CLOSED, S-4 CLOSED, partial start CLOSED, style S1 CLOSED with one behaviour change (new Moderate N-2) |
| New Blocking            | 0                                                               |
| New Serious             | 0                                                               |
| New Moderate            | 2 (N-2 HTTP regression, N-3 CLI shutdown order) plus S-2 residual (N-1) |
| New Minor               | 5                                                               |

Score rationale. Not 8-9: the one fix whose whole point was an invariant ("never a cut prefix as success") still has a reachable hole (N-1), and the refactor made HTTP lose a try/catch it had (N-2). Not 5-6: S-1, S-3, S-4 and the partial-start fix are correct and specced, no new data-loss or security path, and the shutdown re-order is bounded and keeps every disposal that needed ordering.

## Original findings

| ID | Original | Status | Evidence |
| -- | -------- | ------ | -------- |
| S-1 | Ptah CLI spawn drops `taskKind`/`routingSource` | CLOSED | `agent-namespace.builder.ts:333-334` pass both into the `spawnFromSdkHandle` meta; consumer reads them at `agent-process-manager.service.ts:752-753,801-802`. Spec `agent-namespace.builder.spec.ts` "forwards taskKind and routingSource to the SDK handle spawn" asserts them on the SDK-handle call. |
| S-2 | Over-cap route result returned as truncated success | PARTIAL | Char gate added at `route-tool-handlers.ts:101-109`, cap 64,000 (`tool-result-budget.ts:83`). The budget it feeds is two-limit (`tool-result-budget.ts:73-75,93`: 16,000 tokens AND 64,000 chars); the handler checks chars only. See N-1. |
| S-3 | `resolve('')` against `process.cwd()` | CLOSED | `outcome-report.tool.ts:73-74` throws before any target lookup, stat or `pipeline.submit`; reply is an error (`outcome-report.handler.ts` catch, `isError: true`, code `mcp_tool_failed` on stdio because it is not a `ZodError`). The no-store case still returns `{recorded:false}` first (`:71-72`), and `resolved ?? {workspaceRoot:''}` in the handler cannot reach a write because `pipeline`/`store` are undefined there. Spec asserts no submission, no journal change, no row. Side effect on non-deliverable kinds: see N-5. |
| S-4 | Lane-outcomes drain ordering differs per host | CLOSED (with N-3 and N-4) | Electron: `shutdown.ts:260` spawner, `:263` reap, `:266-273` bounded drain, `:275` SQLite close. CLI: `with-engine.ts:433` `shutdownHostRuntime` (agents, proxies, drain, watcher: `shutdown-host-runtime.ts:177-186`) before `:437` `disposeThoth`, which closes SQLite last (`thoth-runtime.ts:221`). VS Code: reap then drain (unchanged order), now with a 2 s bound (`main.ts:47,215`). One rule on all three hosts. |
| Moderate: partial `startLaneOutcomes` | leak and no disposer | CLOSED | `start.ts:52-69` unsubscribes what registered and logs a real `Error`; `startAndRegisterLaneOutcomes` (`:84-97`) registers a disposer even when start throws earlier. Hosts call the helper (VS Code, Electron `phase-2-libraries.ts`, `lane-outcomes-wiring.ts`). Behaviour note: the rollback is all-or-nothing, so one failing registry drops the other (working) subscription too; it is logged at warn, which is acceptable. |
| Style S1 (shared outcome handler) | HTTP and stdio identical | CLOSED except one regression | Reply text, logger adapter and `describeZodIssues` are shared and byte-equivalent to the old copies (issue formatting at `route-tool-handlers.ts:44-53` matches the removed `path.join('.') \|\| '(root)'` variant). Error-code mapping preserved on stdio via `invalidArguments`. Regression: N-2. |

## New and residual defects

### N-1 (Moderate) — The 64,000-char gate does not bound the token limit, so a cut prefix can still be returned as success

- File: `route-tool-handlers.ts:101-109`; budget `tool-result-budget.ts:73-75,93`; engine `apply-output-budget.ts:160-162`.
- Scenario: `charBudget(64_000)` is `{ tokens: 16_000, chars: 64_000 }` (4 chars per token assumed). `budgetText` returns the raw text only when BOTH limits hold (`raw.length <= budget.chars` and the o200k count `<= budget.tokens`); otherwise it reduces and cuts, spools the rest and appends a trailer, with `isError: false`. JSON of a routing roster is denser than 4 chars/token. I measured with the repo's `gpt-tokenizer`: the spec fixture (54,375 chars, repeated prose reason) is 12,553 tokens (4.3 chars/token), but a 100-phase roster with realistic varied reasons (58,347 chars, under the 64,000 gate) is 16,804 tokens, over 16,000. That result passes the new char check and is then cut by the budget: unparseable JSON, success flag, exactly the original S-2 symptom.
- Why the spec misses it: `route-tool-handlers.spec.ts` ("returns a schema-maximum 100-phase route result whole") tests `handleRouteToolCall` only, and its fixture repeats one sentence (token-light). Nothing runs the result through `applyToolResultBudget`.
- Reach: roughly 55,000-64,000 chars, i.e. about 85-100 phases with real `compile-reasons` text. A 70-phase gate (the sized case) is about 40,000 chars and 12,000 tokens, fine. So narrower than the original Serious, hence Moderate.
- Fix: size the override from the real constraint, for example `{ tokens: Math.ceil(MAX / 3), chars: MAX }` or an explicit token cap, and have `handleRouteToolCall` also check `countTokens`, or move the over-cap decision after the budget step (treat `outcome.truncated` for this tool as an error). Add one spec that feeds a varied-reason 100-phase result through `applyToolResultBudget`.

### N-2 (Moderate, new regression) — HTTP `ptah_outcome_report` lost its try/catch around dependency resolution

- File: `protocol-dispatcher.ts:2806-2810` (call), `:2370` (`return outcomeReportResponse(...)`, not awaited inside `handleIndividualTool`'s try), `:371,402` (outer catch).
- Before: `outcomeReportDeps(deps)` was evaluated inside the `try` of `outcomeReportResponse`, so a throwing `resolveOutcomeReport` (store/pipeline factory failure, for example `STATE_STORAGE` missing) became a tool error. After: `deps.resolveOutcomeReport?.()` is an argument expression evaluated before `handleOutcomeReportToolCall` and outside its `try`. The rejection escapes `outcomeReportResponse`, is not caught by the un-awaited `return` in `handleIndividualTool`, and ends at `handleMCPRequest`'s catch as JSON-RPC `-32603` carrying `errorStack` (`:402`), not a tool result.
- Impact: this is exactly the stdio fault already queued as LT-P6-2 (`agent-tool.dispatcher.ts:347`), now present on HTTP too, so the "HTTP and stdio identical" claim holds only because both got worse. Whoever hits the factory failure sees a protocol error with a stack trace instead of a redacted tool error. Unlikely trigger, hence Moderate.
- Fix: resolve inside `handleOutcomeReportToolCall` (pass the resolver, call it inside its `try`), which fixes HTTP and stdio and LT-P6-2 in one place. Extend LT-P6-2 to say it now covers both transports.

### N-3 (Moderate, new) — CLI shutdown reaps agents before the Thoth producers (gateway, cron, triggers) are stopped

- File: `with-engine.ts:433` (`shutdownHostRuntime`) before `:437` (`disposeThoth`); producers stopped inside `disposeThoth` (`thoth-runtime.ts:200-215`, `gateway.stop`, `cronScheduler.stop`, triggers).
- Scenario: a long-running CLI host on the runtime tier with the messaging gateway started. On shutdown, agents are reaped, then up to 2 s of proxy and drain work follows, while the gateway still accepts inbound chat. An inbound message in that window can start a chat session that spawns a new CLI agent. Nothing reaps it (`shutdownHostRuntime` already ran), `process.exit` orphans it (the TASK_2026_323 B11 failure the old comment names), and its outcome write is dropped silently once the disposer closed the pipeline (`outcome-write-pipeline.ts:215`).
- Contrast: Electron stops cron, skills, memory and the chat bridge in `disposeBeforePersistence` before the gateway and before the reap, so it does not have this window. The CLI order is now the reverse of the "stop producers, then consumers" rule the Electron chain follows.
- What did not need Thoth closed first: the workspace watcher dispose is idempotent for later subscription disposals (`workspace-watch-supervisor.ts:242,279-281,288-290`, `INERT_DISPOSABLE`), so `disposeThoth`'s index/symbol-watcher teardown on a disposed watcher is safe. Agents, proxies and the drain need SQLite open, which is why the move was right for them. Nothing in `shutdownHostRuntime` needs Thoth or SQLite closed first. SDK adapter and container disposal still run last (`with-engine.ts:451-452`).
- Fix: split the order, not the move: stop the Thoth producers (gateway, cron, triggers) before `shutdownHostRuntime`, and close SQLite after the drain. Cheapest: `disposeThoth` takes a phase, or `shutdownHostRuntime` accepts a hook that runs between the drain and Thoth. Record as a later task if the window is judged acceptable.
- Also: a hang in agent disposal (`disposeAll` has no bound on the CLI, `shutdown-host-runtime.ts:82-84` default path) now delays Thoth and SQLite close, where before a hang there came after Thoth had closed. The signal-handler path (`CliDIContainer.disposeHostRuntime`) is unchanged and already bounded by the process exiting.

### Point to judge: rotation state already advanced when the over-cap tool error is returned

Decision: a finding, severity Minor. Not Moderate, for these reasons.

- The side effect is real. `route.decide` (`route-tool-handlers.ts:101`) runs the whole pipeline, which records the pick per `phaseId|taskKind` key (`rotation.store.ts` `record`, moves the key to the newest position) and may spend decision-model requests, before the size is known. The cap check at `:103` cannot undo that, and a call rejected as too large still moves rotation.
- The harm is small. Rotation is a soft spread preference with a 200-key cap; one extra advance changes which candidate is preferred next time for those keys. It does not corrupt state, lose data or mislead the caller about what happened.
- It is not self-limiting, though. Re-sending the same arguments yields the same size, so the caller can never succeed and each retry advances rotation again (and spends model requests). The error text (`route-tool-handlers.ts:106`) gives no remedy and the over-cap path logs nothing (the `catch` branch warns, this branch does not).
- Fix (cheap): say what to do ("reduce the number of phases or split the call"), log one `warn` with phase count and size, and, if the service can accept it, a dry-run or `persistRotation: false` option for retries. The better fix is N-1's: make the limit a property the caller can predict, for example lower `phases.max` or compact `reason`, so the over-cap error becomes unreachable.

### Minor

- N-4: Electron captures the lane-outcomes disposer at the end of `postWindow` (`wire-runtime.ts:529`, after `await booter.startOrJoin`), where the old code resolved it from DI at quit. A quit during the heavy boot, or a failed boot that skips line 529, leaves `refs.laneOutcomesDisposer` null and the drain is skipped silently. The registration is DI-time (`phase-2-libraries.ts`), so it could be captured pre-window. Same coupling already exists for `agentProcessManager`; severity low because a boot that has not finished has no lanes producing outcomes, and queued ops live in the KV journal.
- N-5: the S-3 guard (`outcome-report.tool.ts:73-74`) runs for every `kind`, but only `deliverables` touches the filesystem. A `review` verdict reported while no workspace resolves now errors instead of recording. The brief asked for no-workspace to error, so this follows it; narrowing the check to `deliverables` would lose nothing.
- Electron and CLI drain budgets (2,000 ms, `shutdown.ts` `LANE_OUTCOME_DRAIN_BUDGET_MS`; `shutdown-host-runtime.ts:35`) still equal the pipeline's inner `DISPOSE_DEADLINE_MS = 2000` (`outcome-write-pipeline.ts:99`). The journal append after the inner race lands in the KV journal, not SQLite, so a late finish does not lose data; the original "outer strictly larger" recommendation is unaddressed but low value. VS Code now has a bound (`main.ts:47,215`), which closes that half of the original Minor.
- Residual in S-4: writes produced after the drain (for example subagent stops fired while the CLI SDK adapter disposes at `with-engine.ts:451`, or an agent that exits after `reapAgents` timed out on Electron) hit a closed pipeline and are dropped silently (`outcome-write-pipeline.ts:215`). The callbacks are also unsubscribed by the disposer. This is inherent to a bounded drain; a one-line debug log in `enqueue` when `closing || disposed` would make it observable.
- Over-cap path and the `unavailable` shape are not logged or coded, and `tool-result-budget.ts:83` carries the doc comment of the override table above the constant (reads as if the constant were the table). Style-reviewer territory; noted only for N-1's fix.

## Five logic questions (fix round)

1. Fails silently: N-1 (cut JSON as success for roughly 85-100 phases); N-4 and the S-4 residual (late writes dropped without a log).
2. Unexpected user action: retrying an over-cap `ptah_route_decide` with the same arguments loops forever and advances rotation each time (point to judge). Quitting Electron during boot skips the drain (N-4).
3. Wrong answer from data: a roster with verbose varied reasons passes the char gate and is cut by the token gate (N-1).
4. Dependency fails: outcome store/pipeline factory throws, HTTP now returns `-32603` with a stack instead of a tool error (N-2); agent reap hangs on CLI, Thoth and SQLite close wait behind it (N-3).
5. Missing and never mentioned: a spec that pushes the route result through `applyToolResultBudget` on both transports; a CLI ordering spec that includes the Thoth producers; an HTTP spec for a throwing `resolveOutcomeReport`.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| 100-phase result, 54k chars, repetitive reason | YES | char gate passes, token count 12.5k | none |
| 100-phase result, 58k chars, varied reason | NO | passes char gate, 16.8k tokens > 16k, cut and returned as success | N-1 |
| 101+ phases | YES | schema max 100 rejects | none |
| Over-cap result | PARTIAL | tool error, no cut prefix | rotation advanced, no remedy text (Minor) |
| `ptahCliId` spawn with `taskKind` | YES | `agent-namespace.builder.ts:333-334` | none |
| `ptahCliId` spawn without routing fields | YES | both `undefined`, same as before | none |
| Outcome report, no workspace, deliverables | YES | error before any stat | none |
| Outcome report, no workspace, review | YES (errors) | N-5 | arguably over-strict |
| Outcome report, no store, no workspace | YES | `{recorded:false}` first | none |
| Outcome store factory throws, HTTP | NO | `-32603` | N-2 |
| Partial lane-outcomes start | YES | rolled back, disposer registered | all-or-nothing, logged |
| Start throws before callbacks | YES | no-op disposer registered | none |
| Quit with live agents, Electron | YES | reap, drain (2 s), SQLite close | late exits after reap budget dropped silently |
| Quit with live agents, CLI | YES | reap, proxies, drain, watcher, Thoth, SDK, container | N-3 window |
| Drain exceeds budget | YES | VS Code and CLI reject and log; Electron `withBudget` warns | writes continue in background, may hit closed SQLite, journal covers |
| Disposer called twice (signal path plus finally) | YES | unsubs `splice(0)`, `pipeline.dispose` re-sets flags and re-flushes empty queue | none |
| Container without `isRegistered` (test doubles) | YES | `disposeSubsystem` guard inside `try` | none |

## Data flow (shutdown, after the fix)

Electron: `will-quit` -> early metadata flush started -> boot abort -> `disposeBeforePersistence` (proxy pool, timers, update manager, integrity, run-check kill, git/symbol watchers, skill/memory/cron stop, chat bridge: producers stopped) -> gateway stop (2 s) -> session spawner dispose -> agent reap (2 s) -> lane-outcomes drain (2 s) -> SQLite close -> voice, CLI registry (proxies after agents), workspace watcher, diagnostics -> check kills awaited -> final metadata flush (2 s) -> `quit()` in `finally`. Worst-case sum equals the old chain (the same four 2 s budgets), so quit stays bounded. OK.

CLI: workspace index dispose -> agents -> proxies -> lane drain (2 s) -> workspace watcher -> Thoth dispose (index, push, chat bridge, gateway, cron, triggers, curator, embedder, SQLite close) -> SDK adapter -> container dispose. Gap: producers outlive the reap (N-3).

VS Code: reap -> metadata flush -> drain (2 s, now bounded) -> DI clear. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| S-1 Ptah CLI spawn keeps routing metadata | COMPLETE | none |
| S-2 never a cut prefix as success | PARTIAL | token limit (N-1) |
| S-3 no workspace is an error with no write | COMPLETE | N-5 over-strict for review |
| S-4 drain after reap, before SQLite close, Electron and CLI | COMPLETE | N-3, N-4 |
| Partial start releases and still registers a disposer | COMPLETE | none |
| HTTP and stdio behave identically after the refactor | PARTIAL | N-2 changed HTTP to match stdio's fault |
| Quit stays bounded | COMPLETE | none |

Implicit requirements not addressed: observability of writes dropped after the pipeline closed; a test that exercises the budget step for the route tool.

## Decisions

- Rotation advance on over-cap error: Minor finding, not Moderate. Options: Moderate (state mutated for a call the caller cannot use) or Minor (soft preference, no loss). Evidence: `rotation.store.ts` is a most-recent-pick cursor capped at 200 keys; the over-cap result is deterministic so the real defect is the unreachable-success loop, which N-1's fix removes. Reversible: yes.
- Overall verdict APPROVED 7/10 rather than NEEDS_REVISION: no Blocking or Serious remains, the open items are three small, local fixes, and the decision #100 rule is one fix round with the rest to later tasks. If the orchestrator wants the stated invariant of 149440c89 to hold, N-1 is the one to fix before merge; it is a few lines.

## Verdict

- Recommendation: APPROVE, with N-1 fixed in this branch if cheap and N-2 and N-3 recorded as later tasks (N-2 folds into LT-P6-2).
- Confidence: HIGH for S-1, S-3, S-4, partial start and the Electron order (read at the commit with callers); MEDIUM for N-1's reach (my token measurement used a synthetic varied-reason fixture, not live `compile-reasons` output) and for N-3 (depends on a gateway inbound spawning an agent in the window).
- Top risk: a 100-phase gate with realistic reasons is still returned as a cut prefix with `isError: false`, contradicting the commit message.
- What a robust implementation would add: a token-aware cap (or a post-budget truncation check) for `ptah_route_decide` with a spec through `applyToolResultBudget`; resolve outcome dependencies inside the handler's `try` on both transports; stop the Thoth producers before the CLI agent reap; a remedy and a log line on the over-cap error; a debug log when `OutcomeWritePipeline.enqueue` drops after close; an ordering spec per host that includes producers, not only reap, drain and SQLite close.
