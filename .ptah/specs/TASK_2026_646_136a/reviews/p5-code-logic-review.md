# Code Logic Review - TASK_2026_646_136a, phase P5 (outcome producers + Agents tab)

Reviewer: Anthropic family (Sonnet 5.5). Implementers: see batch headers (Google / OpenAI codex / xAI grok / Zhipu).
Checks executed: **none**. No Nx, Jest, tsc, build, serve, e2e or `ptah_get_diagnostics` was run (a heavy check was in
flight elsewhere). Everything below is from reading source at W HEAD and the six commits, plus `T` context docs.

Scope read in full: `lane-completion-outcome.ts`, `lane-completion-notifier.service.ts` (signal path, `checkLaneDeliverable`),
`lane-completion-envelope.ts`, `lane-failure-class.ts`, `lane-auth-classifier.ts`, the changed regions of
`agent-process-manager.service.ts` (spawn copy, `handleExit`, `stop`, `handleTimeout`, `signalLaneCompletion`),
`register.ts`; `skill-telemetry-seam.adapter.ts`, `skill-invocation-recorder.ts`, the changed regions of
`skill-trigger.service.ts`; `agent-outcome-rpc.handlers.ts`, `agent-outcome.schema.ts`; `outcome-report.tool.ts` with its
dependencies (`report-effect.ts`, `OutcomeWritePipeline.submit`, `SqliteLaneOutcomeStore.applyInTransaction`,
`applyOutcomeEffect`); `agent-outcome-signals.ts`, state/RPC services, card/drawer/view diffs; `post-tool-use-hook-handler.ts`,
`subagent-run-tag.ts`, the budget-monitor stop path. Spec files were not read line by line; I read the batch reports for
their claims. Route-tool files (P6), the known `ptahCliId` spawn drop and the `resolve('')` workspace fallback are not counted.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 3              |
| Moderate issues     | 9              |
| Failure modes found | 13             |

Score basis: the producers are structurally sound. The enqueue is synchronous and isolated by `try/catch`, the dedupe key is
set before the first `await`, the report path is Zod-parsed, and the correlation guards do what they say. That keeps this out of
the 3-4 band. It is held below 7 by three Serious defects where the code returns a wrong or misleading answer on a likely path: a
raw reader error reaches the webview, the Agents tab shows a failed or non-durable read as "no data yet", and the auth classifier
turns ordinary crashes into `auth`. Evidence between bands: no data-loss or corruption path was found (0 Blocking), but several
Delivered-rate inputs are systematically skewed (M-1, M-5, M-7).

## Five logic questions

### 1. How does this fail silently?

- `loadAgentOutcomeSignals` catches every error and stores `{}` / `null`
  (`libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts:118`). A rejected `agent:outcomeSignals`
  (reader error, INVALID_PARAMS from more than 500 agents, RPC timeout) renders as "Outcomes (30d): no data yet", the same text
  as "agent never ran". The batch-8 report admits the perf spec relies on this swallow (a missing stub method throws a TypeError
  that the catch absorbs). A refresh that fails after a success wipes figures that were already on screen. (S-2)
- The result field `persistent` is produced by the handler and never read by any UI code (`grep persistent` in
  `skill-synthesis-ui` hits only a comment at `skill-synthesis-rpc.service.ts:623`). The plan said `isPersistent()` exists so
  "no history because no store" differs from "no history" (`implementation-plan-part-b.md:636`). It is not surfaced. (S-2)
- An invalid `taskKind` / `routingSource` on a lane spawn drops the whole outcome row. `recordLaneCompletion` runs
  `LaneOutcomeRowSchema.safeParse` and, on failure, logs `Invalid lane outcome { runId }` and returns
  (`lane-outcome-recorder.service.ts:54-58`). The log names no field. The `execute_code` spawn path copies the fields untyped
  (`agent-namespace.builder.ts` spreads `...requestFields`, `agent-process-manager.service.ts:641-642`); only `effort` is
  validated there. (M-2)
- A stat failure on a declared deliverable becomes `exists: false, bytes: 0` and is written as a negative verdict
  (`outcome-report.tool.ts:121-130`, `checkLaneDeliverable` catch). An I/O error and a missing file are the same stored fact. (M-6)
- `fireHarvest` failure is logged at `debug` only (`skill-trigger.service.ts:497-505`), so unreconciled spec verdicts leave no
  trace in a shipping log. (Minor, m-3)

### 2. What user action produces unexpected behaviour?

- User stops a lane: the row is written with verdict `failed`, `failureClass: null`, and it enters the Delivered denominator.
  The card shows for example `Delivered 0% (0/3)` next to `Top failure: no failures recorded`. (M-5)
- Orchestrator steers a continuation-capable lane over several turns: each ending is a new run key, so turn 1 ("planned, not
  written yet") is stored as `no-deliverable` / `bad-output` and counted, although the lane delivers in turn 2. (M-7)
- Orchestrator re-sends a `revise` report after a timeout or a doubt: each call mints a new `reportId`, so each one adds a
  revise round (`outcome-report.tool.ts:148`, `sqlite-lane-outcome.store.ts:160-165`). (M-4)
- Orchestrator passes an absolute in-workspace path: the whole report is rejected with "deliverable path escapes workspace"
  (`outcome-report.tool.ts:110`). The message is misleading and one bad path rejects all 20. (m-1)
- A lane or subagent calls `ptah_outcome_report` on its own run (see M-3).

### 3. What input data produces a wrong answer instead of an error?

- A failed lane whose last 16 KiB of stdout contains the bare token `401` (a stack frame `file.ts:401:15`, a line number, a byte
  count) or the word "unauthorized" is classified `auth`, not `crash` (`lane-auth-classifier.ts:3`, precedence at
  `lane-failure-class.ts:22`). (S-3)
- Deliverables declared by path where the file already exists in the worktree and the run is a subagent: verdict `delivered`
  because `row.startedAt` is `null` for every subagent row (`lane-outcome-recorder.service.ts:116`), so the mtime clause in
  `deliverablesVerdictOf` (`report-effect.ts:44-48`) never applies. (M-1)
- Windows drive-relative entry such as `E:foo`: `isAbsolute('E:foo')` is false and `relative(root, resolve(root,'E:foo'))`
  returns an absolute path with no `..`, so it passes the confinement test at `outcome-report.tool.ts:109-110`. (M-8)
- More than 2 000 outcome rows in 30 days across the requested slugs: the store applies a global `slice(0, 2000)` after decoding
  per-slug results (`sqlite-lane-outcome.store.ts:326-333`). Quiet agents lose rows to a busy one and show a lower `runCount`,
  or "no data yet", with no `capped` flag. The reader's own cap warning (`lane-outcome-reader.service.ts:72`) can never fire on
  SQLite because the store already truncated. (M-9; the store predates P5, B7 is what exposes it)

### 4. What happens when a dependency fails?

- Reader throws inside `agent:outcomeSignals`: the handler logs the error name and **rethrows the raw error**
  (`agent-outcome-rpc.handlers.ts:93-96`). `RpcHandler.handleMessage` returns `errorObj.message` verbatim to the webview, logs
  the full `Error`, and reports it to Sentry (`rpc-handler.ts:241-251`). The handler comment says the reader message "can quote a
  path", which is the exact leak. (S-1)
- Recorder absent / throwing in the lane path: handled. The lazy `isRegistered` resolve plus `try/catch` keeps the completion
  signal going (`lane-completion-outcome.ts:25-69`, `register.ts` factory). The warn log carries only `runId` and error name.
- Seam throws during the subagent join: handled in the reader (`lane-outcome-reader.service.ts:134-143`). The result degrades to
  `telemetryJoin: unavailable`.
- Store closed while the report tool resolves an `agentId`: `store.get` throws and the tool returns
  `{ recorded: false, reason: 'outcome store unavailable' }` (`outcome-report.tool.ts:90-96`). That is as planned.
- Reader unregistered: `{ signals: {}, persistent: false }`, a success-shaped answer. Acceptable only if the UI honours
  `persistent` (see S-2).

### 5. What is missing that the requirements never mentioned?

- Caller identity on `ptah_outcome_report`: the tool is listed on every `tools/list` (`protocol-dispatcher.ts:550-552`), including
  to lanes connected through their own MCP URL. Nothing ties the caller to the run it grades. (M-3)
- Session children (`ptah_session_start`) go through `signalSessionChild` and never enqueue an outcome row, so routing never
  learns about them. Undocumented in the plan.
- `skillsLoaded` is always `null` for subagents (the non-`subagent:` branch of the seam is unreachable from the reader), by
  documented decision PB-3. The field exists but can never carry data until PB-3 is closed.
- No idempotency key on `ptah_outcome_report` (M-4).
- A bound on the number of slugs the Agents tab sends versus the server's 500 cap: no chunking (m-2).

## Failure modes

### FM-1 Raw reader error reaches the webview

- Trigger: `reader.agentSignals` rejects (SQLite busy / corrupt, zod decode failure with a path in the message, seam error).
- Symptom: webview gets the unfiltered `Error.message`; Sentry gets it too; the log line the handler wrote is duplicated by
  `RpcHandler`'s own `logger.error`.
- Evidence: `agent-outcome-rpc.handlers.ts:90-96`, `rpc-handler.ts:241-251`.
- Current handling: `throw error` after a code-only log.
- Recommendation: catch, log the error name, and throw `RpcUserError` with fixed text and a code from the shared union
  (add one such as `OUTCOME_READ_FAILED` to `rpc-error-codes.types.ts`).

### FM-2 Agents tab cannot tell failure / no durable store from "no data yet"

- Trigger: RPC error or timeout, more than 500 agents, reader unregistered, SQLite migration failed (`persistent: false`).
- Symptom: every agent card says "no data yet"; figures already shown are replaced by that text on a failed refresh.
- Evidence: `skill-clones-state.service.ts:112-121`; no consumer of `persistent`.
- Current handling: swallow plus `{}`.
- Recommendation: add an `outcomeStatus` signal (`ok` / `unavailable` / `not-persistent`); keep the last good figures on a failed
  refresh; show "outcomes unavailable" or "not saved across restarts". Chunk slugs at 500.

### FM-3 Auth false positive turns crash into auth

- Trigger: failed lane exit; the 16 KiB stdout tail or the last 8 error segments contain `\b401\b`, "unauthorized", or
  "authentication required" as data (test output, source under review).
- Symptom: `failureClass: 'auth'`; Agents tab "Top failure: auth"; the decision-model classifier only fills a `null` class, so
  the wrong class is final.
- Evidence: `lane-auth-classifier.ts:3-9`, `lane-failure-class.ts:22`, tail size `agent-process-manager.service.ts:96`; the
  spec (`lane-auth-classifier.spec.ts`) has no negative case for `file.ts:401:12` or a word inside code.
- Current handling: broad token match with precedence above `crash`.
- Recommendation: require an auth phrase near an error context (`http 401`, `status 401`, `401 unauthorized`), or limit the match
  to `error`-type segments and the last N lines; add negative fixtures.

### FM-4 Stale `authMatched` survives a continuation

- Trigger: continuation-capable lane fails with auth wording (flag set), is continued, then is stopped or times out.
  `handleExit` is the only writer of `tracked.authMatched` (`agent-process-manager.service.ts:2349-2353`) and its no-op branch
  for non-`running` leaves the old value; `signalLaneCompletion` passes it (`:2555`).
- Symptom: a stop gets class `auth` (the classifier checks `authMatched` before `status`, contradicting plan D5 "stopped is
  null"; `lane-failure-class.ts:20-22`).
- Evidence: as above; reachability depends on whether a `failed` record can be continued, which I did not verify.
- Recommendation: reset `authMatched` when a turn starts, and return `null` for `status === 'stopped'` before the auth test.

### FM-5 Stopped lane counted as a failure with no class

- Trigger: user or orchestrator stops a lane.
- Symptom: verdict `failed`, class `null`; Delivered denominator includes it; "no failures recorded" shown beside a low rate.
- Evidence: `lane-completion-notifier.service.ts` `verdictOf` (`status !== 'completed'` gives `failed`); `agent-signals.ts:20`;
  `agent-outcome-signals.ts` "Top failure" fallback.
- Recommendation: carry `status` on the stored row (or a `stopped` verdict) and exclude it from the Delivered denominator, or
  render the figure with the stopped count.

### FM-6 Continuation turns multiply runs

- Trigger: lane that supports continuation ends more than once.
- Symptom: one agent run counted N times; early turns recorded as `no-deliverable` / `bad-output`.
- Evidence: dedupe key `${agentId}:${completedAt}` (`lane-completion-notifier.service.ts:340`, comment at `:288-298`).
- Recommendation: for outcome rows use the agent id as run key and update on later endings, or record the turn number and
  evaluate only the final one.

### FM-7 Deliverables report cannot detect pre-existing files for subagents

- Trigger: subagent run, declared path already exists and is non-empty (worktrees always contain tracked files).
- Symptom: `delivered`.
- Evidence: `lane-outcome-recorder.service.ts:116` (`startedAt: null`), `report-effect.ts:37-52`, plan text at
  `implementation-plan-part-b.md:514` ("with the subagent's startedAt as spawn time").
- Recommendation: capture the SubagentStart time into the budget/stop payload or let the caller pass `since`; until then document
  that subagent `delivered` means "exists and non-empty".

### FM-8 Report on a lane `agentId` during the write window becomes a 24-hour hold

- Trigger: the orchestrator reports by lane `agentId` while the lane's row is still in the journal / queue, store open.
- Symptom: `recorded: 'held'` for `subagent:<laneAgentId>`, which never arrives, and it expires after 24 h (counts against the
  500-hold cap). The report never joins the lane row.
- Evidence: `outcome-report.tool.ts:80-89` reads only the store; `OutcomeWritePipeline.submit` checks `pendingInsert` by `runId`
  (`outcome-write-pipeline.ts:239-245`), which does not match `subagent:<id>`.
- Recommendation: also look at pending journal/queue rows by `agentId`, or answer `queued`/error for an unmatched lane-shaped id.
  Window is narrow in practice (drain is `setImmediate`); worse when the DB is closed.

### FM-9 Self-grading through `ptah_outcome_report`

- Trigger: any MCP client in the workspace, including a lane or subagent, calls `review {approved}` or `deliverables` against a
  run id or agent id it knows.
- Symptom: `finalReview`, `reviseRounds`, `verdict` of another or its own run change; routing and the Agents tab read them as
  evidence.
- Evidence: no caller check in `runOutcomeReport` (`outcome-report.tool.ts:66-169`); listing at `protocol-dispatcher.ts:550-552`.
- Recommendation: reject a target whose run belongs to the caller's own session, or record the reporter session id and ignore
  self-reports when ranking. If accepted as trust-the-orchestrator, record that as a decision.

### FM-10 Windows drive-relative path passes the workspace fence

- Trigger: `paths: ["E:secret.txt"]` on win32.
- Symptom: the file outside the workspace is stat-ed; its existence, size and mtime decide the stored verdict.
- Evidence: `outcome-report.tool.ts:107-110`.
- Recommendation: after `relative`, also reject `isAbsolute(rel)`; resolve with `realpath` if symlinks matter.

### FM-11 Revise reports are not idempotent

- Trigger: a repeated `revise` call.
- Symptom: `reviseRounds` and `avgReviseRounds` inflate.
- Evidence: `reportId = randomUUID()` per call (`outcome-report.tool.ts:148`); `UPDATE ... revise_rounds + 1`
  (`sqlite-lane-outcome.store.ts:160-165`).
- Recommendation: accept an optional client `reportKey` and derive `reportId` from it, or dedupe identical review reports within
  a short window per run.

### FM-12 Signal volume cap hides truncation

- Trigger: 30-day window with more than 2 000 rows over the requested slugs. One SQLite query per slug, each up to 2 000 rows,
  all decoded with Zod before the global slice: up to 500 x 2 000 decodes on the host thread per Library refresh.
- Symptom: lower counts for quiet agents; refresh latency on large libraries (`refreshClones` waits on this call, so it also
  extends the tab's `loading` flag).
- Evidence: `sqlite-lane-outcome.store.ts:316-334`, `lane-outcome-reader.service.ts:68-77`.
- Recommendation: aggregate in SQL (`GROUP BY role, verdict, ...`) or cap per slug and return a `capped` marker.

### FM-13 Correlation-guard log volume

- Trigger: Agent/Task `PostToolUse` whose session id cannot be resolved (`resolveHookSessionId` returns `null`).
- Symptom: the once-per-session dedupe is skipped, so a `warn` is logged for every such call
  (`post-tool-use-hook-handler.ts:149-160`). The `runTagMissSessions` Set also never evicts (one string per parent session for the
  process lifetime).
- Recommendation: dedupe on a fallback key (tool name) and cap the Set.

## Blocking issues

None found. Scope examined: every write and read path from lane exit to stored row, the report tool to the pipeline and store, the
RPC handler to the card. Residual uncertainty: I did not execute any check and did not read the pipeline's drain/journal code
beyond `submit`; the P2 reviews cover it.

## Serious issues

### S-1 `agent:outcomeSignals` rethrows the raw reader error

- File: `libs/backend/rpc-handlers/src/lib/handlers/agent-outcome-rpc.handlers.ts:90-96`
- Scenario: any reader rejection (SQLite error text includes the database path; a Zod decode message includes field data).
- Impact: the message goes to the webview and to Sentry. The repo rule is typed, fixed-text, coded RPC errors
  (`RpcUserError` with a code from `rpc-error-codes.types.ts`); the handler's own comment states the path-quoting risk and then
  rethrows anyway. The comment "the rejection is the RPC error result" is the bug, not the mitigation.
- Fix: map to `RpcUserError('Outcome signals are unavailable.', 'OUTCOME_READ_FAILED')` (new shared code), keep the name-only log.

### S-2 Agents tab shows failure and non-durable stores as "no data yet"

- File: `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts:112-121`;
  `components/clones/agent-outcome-signals.ts:38-47`; `skill-synthesis-rpc.service.ts:623-639`
- Scenario: RPC failure, more than 500 agents, `persistent: false`.
- Impact: the user reads "this agent has no runs" when the read failed or nothing is being saved; a previously good figure
  disappears on a transient error. This defeats the plan's stated purpose for `isPersistent()`.
- Fix: see FM-2. Add a spec that a failed refresh keeps the last signals and that `persistent: false` renders a notice.

### S-3 Auth classifier matches bare `401` and "unauthorized" in arbitrary output

- File: `libs/backend/cli-agent-runtime/src/lib/limits/lane-auth-classifier.ts:2-9`, applied to the 16 KiB stdout tail
  (`agent-process-manager.service.ts:96, 2349-2352`)
- Scenario: failed lane output with `:401:` line numbers, or a lane that works on auth code.
- Impact: wrong `failureClass` stored with precedence over `crash`, final because classification only fills `null`. The Agents
  tab "Top failure" and any routing use of failure classes are skewed toward `auth`.
- Fix: FM-3.

## Moderate and minor issues

Moderate

- M-1 Subagent deliverables verdict ignores mtime because `startedAt` is null (`report-effect.ts:44-48`,
  `lane-outcome-recorder.service.ts:116`). See FM-7.
- M-2 Invalid `taskKind` / `routingSource` through `execute_code` drops the whole lane row; the log lacks the field name
  (`lane-outcome-recorder.service.ts:54-58`; no validation beside `assertEffort` in `agent-namespace.builder.ts:176-200`). Parse
  the two fields at the builder, or null them in `enqueueLaneCompletionOutcome` when invalid.
- M-3 `ptah_outcome_report` has no caller check (FM-9).
- M-4 Duplicate `revise` reports inflate rounds (FM-11).
- M-5 Stopped lanes count against Delivered with no class (FM-5). Contradicts plan D5 in effect.
- M-6 Stat error stored as "missing" (`outcome-report.tool.ts:121-130`). Return a `recorded: false, reason` (or skip the path)
  instead of writing `exists: false` when the error is not ENOENT.
- M-7 Continuation turns produce multiple runs (FM-6).
- M-8 Drive-relative path escapes the workspace fence (FM-10).
- M-9 Silent 2 000-row truncation and per-slug fan-out decode (FM-12). Origin is the pre-P5 store; B7 makes it user-visible.

Minor

- m-1 Absolute in-workspace paths are rejected with a message that says "escapes workspace" (`outcome-report.tool.ts:110`); one
  bad path rejects the whole report.
- m-2 No chunking of slugs against the server's 500 cap (`skill-clones-state.service.ts:112`).
- m-3 `fireHarvest` failure at `debug` only (`skill-trigger.service.ts:497-505`); raise to `warn` with the error name.
- m-4 FM-8 (lane `agentId` report in the write window) and FM-13 (guard log flood, unbounded Set).
- m-5 `signalledKeys` is shared between lane and session-child keys with a 256 cap (`lane-completion-notifier.service.ts:72`);
  after 256 other transitions a replayed signal would enqueue a second outcome (harmless: the store's `insertIfAbsent` is keyed on
  `runId`).
- m-6 `signals[slug] ??= ...` and `result[slug] = ...` on plain objects (`lane-outcome-reader.service.ts:79`,
  `agent-signals.ts:38`); slugs such as `constructor` or `__proto__` are not own-property safe. The card guards with
  `raw.slug === c.slug`, so the effect is only a missing zero entry. Use `Object.create(null)` or a `Map`.
- m-7 Transient "no data yet" appears while the second RPC is in flight, because `clones` is set before signals load
  (`skill-clones-state.service.ts:66-71`).

## Data flow

1. Spawn (`ptah_agent_spawn` MCP, stdio dispatcher): `taskKind` / `routingSource` Zod-parsed (`agent-spawn-args.schema.ts:45,50`).
   OK. The `ptahCliId` branch drops them (known, P6).
2. APM copies both onto `AgentProcessInfo` (`agent-process-manager.service.ts:641-642`) and the Ptah CLI record
   (`:800-802`, with `providerId`). OK for system CLIs. `execute_code` input unvalidated (M-2).
3. Exit: `handleExit` sets status, failure kind, and `authMatched` (`:2349-2353`). Gap: S-3, FM-4.
4. `signalLaneCompletion` -> `LaneCompletionNotifier.signal`: key set before the first `await` (`:340-344`), so concurrent exits
   and timeout-then-exit collapse to one. OK.
5. `buildSignal` awaits disk checks, then `enqueueLaneCompletionOutcome` runs before the parent checks, so refused deliveries are
   recorded too. OK. Gap: continuation endings (FM-6), stop semantics (FM-5).
6. Recorder: row schema `safeParse`; invalid row dropped with a runId-only warn (M-2). Then `pipeline.enqueue` (synchronous,
   no store I/O). OK.
7. Subagent side: `onSubagentStop` -> recorder with `runId: agentId`; dedupe by `subagent-run:<id>` before the store write
   (`skill-invocation-recorder.ts:36-44`). OK. If the store write throws, the key stays remembered, so a retry is skipped (minor).
   Read-time seam join (`SELECT ... WHERE source='subagent' AND run_id IN (...)`): one row per run, `ambiguous` on duplicates. OK.
8. Report tool: Zod parse -> target resolution (store reads) -> disk facts -> `pipeline.submit` -> `applied` / `held` / `queued`
   echoed. OK. Gaps: FM-7..11.
9. Read: `agent:outcomeSignals` -> Zod strict (500 x 200) -> `reader.agentSignals` -> computed signals. Gaps: S-1, FM-12.
10. UI: state service -> formatter -> card/drawer. Gaps: S-2, M-5.

## Requirements fulfilment

| Requirement                                              | Status   | Gap                                                                    |
| -------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| 5.1 one record per deduplicated lane completion          | COMPLETE | Per ending, not per lane (FM-6)                                        |
| 5.3 taskKind / routingSource from spawn                  | PARTIAL  | `ptahCliId` path (known, P6); `execute_code` unvalidated (M-2)         |
| 5.5 subagent deliverables, same disk rules               | PARTIAL  | mtime rule inert for subagents (FM-7)                                  |
| 5.6 review attach / unknown id error                     | COMPLETE | Result is `recorded:false`, not an MCP error; acceptable              |
| 5.8 no prompt text or paths stored                       | COMPLETE | Payload stores stat facts only                                         |
| 5.9 write failure never blocks the lane result           | COMPLETE | Enqueue isolated and sync                                              |
| 9.1 Agents tab signals, counts, W label                  | COMPLETE | Formula matches; stopped runs skew it (M-5)                            |
| 9.2 "no data yet" for empty                              | PARTIAL  | Also shown for failure / no store (S-2)                                |
| 10.1-10.2 failure class, fixed precedence                | PARTIAL  | Auth false positives (S-3); stale flag (FM-4)                          |
| B7 bounded data, no raw errors                           | PARTIAL  | Input bounded; raw error rethrown (S-1); 2 000-row silent cap (FM-12)  |
| P1c guards: reject bad signals, keep valid ones          | COMPLETE | Log-volume edge (FM-13)                                                |

Implicit requirements not addressed: caller identity on outcome writes; session-child outcomes; idempotency of reports; a
visible "capped" or "not durable" indicator.

## Edge cases

| Case                                         | Handled | How                                          | Concern                              |
| -------------------------------------------- | ------- | -------------------------------------------- | ------------------------------------ |
| Duplicate terminal paths (timeout then exit) | YES     | Same `completedAt`, key before `await`       | -                                    |
| Recorder not registered                      | YES     | Lazy `isRegistered`, returns null            | -                                    |
| Recorder throws                              | YES     | `try/catch`, warn                            | Log has no field detail              |
| Empty slugs                                  | YES     | `[]` returns `{}`                            | -                                    |
| > 500 slugs                                  | PARTIAL | INVALID_PARAMS                               | UI swallows it (S-2)                 |
| Report before subagent stop                  | YES     | Held up to 24 h                              | Typo agentId also "held"             |
| Report for lane agent in write window        | NO      | Held for a `subagent:` id that never arrives | FM-8                                 |
| Concurrent reports, same run                 | YES     | Receipt per `reportId`, transaction          | Duplicates not deduped (FM-11)       |
| Unknown / invalid `taskKind` (MCP)           | YES     | Zod enum at spawn                            | -                                    |
| Unknown / invalid `taskKind` (execute_code)  | NO      | Row dropped                                  | M-2                                  |
| Windows path forms                           | PARTIAL | `..` check only                              | FM-10                                |
| Agent tool without agent id                  | YES     | Warn once per session                        | FM-13                                |
| Budget stop with no handoff record           | YES     | Now publishes if the agent id exists         | Stale `registryRecord` read, minor   |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM (no check executed; two paths, FM-4 reachability and lane exposure of the report tool, are inferred from
  code and not confirmed at runtime)
- Top risk: a thrown reader error is returned verbatim to the webview and Sentry while the Agents tab reads any failure as
  "no data yet".
- What a robust implementation would add: a coded `RpcUserError` for outcome read failures; a tri-state outcome status in the
  Library state service that honours `persistent` and keeps last-good figures; a tighter auth matcher with negative fixtures and
  a `stopped` early-out; field-level validation (or nulling) of `taskKind` / `routingSource` at the `execute_code` boundary;
  an idempotency key and caller-session check on `ptah_outcome_report`; a `startedAt` for subagent rows so the mtime rule works;
  a `realpath`/`isAbsolute(rel)` fence; a stopped-run exclusion (or count) in Delivered; per-slug SQL aggregation with a
  `capped` marker.
