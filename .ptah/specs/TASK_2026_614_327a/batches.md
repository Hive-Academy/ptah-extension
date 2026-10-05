# Batches - TASK_2026_614_327a

Scope: Stage D (D.1-D.12) and Stage E (E.1-E.6) only. Stages A, B, C and F are not decomposed here.

Total tasks: 31 | Batches: 15 | Complete: 0/15
Unblocked: Batches 1-15 (decisions answered 2026-10-05)

## User Decisions (2026-10-05)

- Decision 1 (D.11): **(b) refactor to an explicit `onMessage` callback on `StreamTransformer`** (user chose against
  the recommendation). Batch 15 runs directly after Batch 3 (same executor file); Batch 15 moves the D.2 release from
  the `stop()` override to the transformer's end callback and deletes `CompactionObservingWatchdog`.
- Decision 2 (D.3): gate the subagent stop on the existing `compaction.enabled` (recommended option).
- Decision 3 (D.5): root-scoped frontend store (recommended option).
- Decision 4 (E.4): gate `spawnFromSdkHandle` only; document why live continuation stays ungated (recommended option).

## Decisions for the user

The original options, kept for the record.

### Decision 1 — D.11: how the 27b message tap reaches stream messages (blocks Batch 15)

Today `CompactionObservingWatchdog` (`session-query-executor.service.ts:358-374`) overrides `observe()` so every
stream message reaches the compaction tap. It works (every message passes `stream-transformer.ts:423` first), but it is
a hidden coupling: if the watchdog is ever not passed to the transformer, the coordinator, the port and the subagent
monitor all stop receiving messages without an error.

- **(a) Accept the subclass and pin it with a spec (Recommended).** Add one executor spec that drives a real
  `StreamTransformer` and asserts the tap sees `result`, `status: 'compacting'` and `compact_boundary`. Cost: 1 spec
  file, no runtime change, no second touch of the executor's runtime code.
- **(b) Refactor to an explicit `onMessage` callback on `StreamTransformer`.** Cost: 4 source files
  (`stream-transformer.ts`, `session-lifecycle-manager.ts` for the record field, `sdk-agent-adapter.ts`,
  `session-query-executor.service.ts`) plus 3 specs. The executor is touched a second time after Batch 3, and D.2's
  release moves from the `stop()` override to the transformer's end callback.

Why (a): the coupling is real but narrow, a spec catches the one regression that matters, and (b) costs about 7 files
on the session hot path for no behaviour change.

### Decision 2 — D.3: off switch for the subagent stop (blocks Batch 12)

The subagent handoff/safety stop (`subagent-budget-monitor.ts:257-270`) acts on every session and ignores
`compaction.enabled`.

- **(a) Gate the stop on the existing `compaction.enabled` (Recommended).** `enabled=false` makes the monitor
  observe-only (it still counts, so the advice and snapshots keep working). Default behaviour is unchanged (acting).
  Cost: 2 files (monitor + spec).
- **(b) New key `compaction.subagentStopEnabled`, default `true`.** Independent of `compaction.enabled`. Cost: about 7
  files (platform-core `FILE_BASED_SETTINGS_KEYS`/defaults/`KNOWN_CONFIG_KEYS`, `CompactionConfig` type, provider,
  RPC types, monitor + spec), and a settings toggle only when Stage A.5 builds the card.
- **(c) New key, default `false` (observe-only, like the A8 coordinator).** Same cost as (b), and it changes shipped
  behaviour: no subagent is stopped until the user opts in.

### Decision 3 — D.5: how long "Keep this session" lasts (blocks Batch 13)

`keptKeys` lives in the banner component (`session-budget-banner.component.ts:196`), and the banner is rebuilt under
`@if (resolvedSessionBudget(); as budget)` (`chat-view.component.html:136`), so a tab switch or reload brings the
rotation banner back.

- **(a) A root-scoped frontend store keyed by `sessionId:threshold` (Recommended).** Survives tab switches and
  remounts; lost on a webview reload. Cost: 4 frontend files (new store + spec, banner + spec). Needs the
  before/after screenshots (dark + light) at completion.
- **(b) Persist through the backend budget entry (a `keep-rotation` action next to `dismiss`).** Survives a reload
  until the session is released. Cost: about 7 files across shared, agent-sdk, rpc-handlers and chat; the
  `SessionBudgetAction` union is a libs/shared type, so every importer is typechecked.
- Wording: no change to the "Keep this session" label is proposed. Say so if you want one.

### Decision 4 — E.4: should the resume gate apply to idle-lane continuation and Ptah CLI resumes? (blocks Batch 14)

`continueConversation` and `spawnFromSdkHandle` (`agent-namespace.builder.ts:282-318`) skip the 60k / 10 min gate.

- **(a) Gate `spawnFromSdkHandle` only; leave live continuation ungated and document why (Recommended).** A live
  continuation keeps its context; the SDK idle release is 5 min, below the 10 min idle rule, so only the 60k rule could
  ever apply there. Cost: 2-4 files (namespace builder + spec, manager + spec for the shared `resumeDecision`). The
  same batch adds the blocked-model check to `spawnFromSdkHandle` (D.12 B-m2).
- **(b) Gate both.** A live lane over 60k would be swapped for a fresh handoff in the middle of a conversation; the
  orchestrator sees `resumeDecision: fresh` on a call that never had one before.
- **(c) Gate `spawnFromSdkHandle`; on continuation only report an advisory `resumeDecision` without blocking.**

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- The user's uncommitted edits to `session-query-executor.service.ts` (~240-330, Sonar promise/try) and
  `lane-budget-guard.ts:141` are present and correct — verified on disk (`git status`: both modified, uncommitted).
  See risk R1.
- `StreamTransformer` calls `activityWatchdog.stop()` in its `finally` on every teardown path
  (`stream-transformer.ts:884`) — verified; Batch 3 relies on it for D.2.
- `SubagentRecord` has no task text (`libs/shared/src/lib/types/subagent-registry.types.ts:31-100`) — verified. D.8
  takes the task text from the parent's `Agent`/`Task` `tool_use.input` the monitor can see, so no shared type changes
  (Task 4.1 verifies the input field names against a captured message or the SDK types).
- cli-engine already depends on `@ptah-extension/vscode-lm-tools` (`libs/backend/cli-engine/package.json:19`,
  `container.ts:121`) and registers workspace-intelligence (`container.ts:636`), which binds
  `TREE_SITTER_PARSER_SERVICE` — verified; D.10 is a wiring change only (Task 7.1 confirms the token resolves).
- The effective subagent TTL is computed in `SdkQueryOptionsBuilder.build()` (`sdk-query-options-builder.ts:1166-1177`)
  and is not visible to the executor — verified. Task 3.2 exposes it on the build result; it does not touch the
  system-prompt parts of that file (TASK_2026_609_c495).
- The HTTP MCP path has no request abort signal today (`mcp-request-context.ts:22`, no `signal`); stdio handles
  `notifications/cancelled` (`stdio-mcp-server.service.ts:241-255`) — verified; Batch 10 adds the plumbing.
- `execute_code` exposes a cancellation hook the `waitFor` namespace call can use — UNVERIFIED; Task 8.3 checks it and
  stops with a progress note if there is none (then `waitFor` keeps its 15 min default and the gap is recorded).

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1: the user's uncommitted Sonar edits in `session-query-executor.service.ts` and `lane-budget-guard.ts` would be swept into the Batch 2/3 commits | HIGH | Orchestrator commits them on their own (or confirms they landed) before Batch 2 or Batch 3 starts; both batch briefs say to build on them, not revert them |
| R2: another developer is editing the Electron/CLI DI composition roots | MEDIUM | Only Batch 7 touches a composition root (`cli-engine/src/lib/container.ts`); it starts only after that fix is committed and re-reads the file first |
| R3: TASK_2026_609_c495 owns the system-prompt parts of `sdk-query-options-builder.ts` | MEDIUM | Task 3.2 touches only the `subagentTtl` lines (~1166-1177) and the build result type; no agent-generation, `.claude/agents` or prompt files |
| R4: `subagent-budget-monitor.ts`, `agent-process-manager.service.ts` and `agent-namespace.builder.ts` land in two batches each (4 then 12; 8 then 14) | LOW | The second batch is decision-gated and runs strictly after the first; each brief says to re-read the file |
| R5: D.4 double count on CLIs that emit both `tool-call` and `command` for one call (Codex) | MEDIUM | Task 2.1 dedupes by `toolCallId`; spec covers Codex (both segments) and OpenCode (`command` only) |
| R6: a `stop()` override that releases on teardown could release a session that is still resuming | MEDIUM | Task 3.1 spec: release on transformer end, then a resumed run re-registers (bind sees no state) |
| R7: a retried `stopSubagent` could fire twice for one subagent | MEDIUM | Task 4.1: bounded retry (max 2 more attempts on the next subagent messages), `stopFired` set only on success or when the cap is spent |
| R8: killing Nx on cancel could kill a run another caller still waits for | LOW | Task 9.1 tracks PIDs per call; only the cancelled call's tree is killed |
| R9: load-flaky specs (`subagent-message-dispatcher.spec.ts`, `session-handoff-writer.spec.ts`) | LOW | Re-run alone before calling a failure real (context.md Workspace lessons) |

Edge cases:

- Read of a whole file over budget with a short outline — Task 1.1
- Invalid hand-edited budget value read many times per turn — Task 1.2 (warn once per key and value)
- `.gitignore` write fails with EACCES/EROFS — Task 1.3
- Codex lane emitting `tool-call` then `command` for the same call — Task 2.1
- Stream ends without abort, then the session resumes — Task 3.1
- Message without `cache_creation` on a 1h-TTL session — Task 3.2
- Provider without cache figures — Task 3.3
- `stopSubagent` rejects — Task 4.1
- User steers the parent in the same tick as a monitor stop — Task 4.2
- Coordinator subscriber throws — Task 4.3
- PostCompact id change while a port read is in flight — Task 5.1
- Slow tree-sitter outline when the tool is aborted — Task 5.2
- Rotation after the user extended the session — Task 6.1
- Spawn between the steer and stop writes — Task 6.3
- `waitFor` inside an `execute_code` call that times out at 30 s — Task 8.3
- MCP client cancels / host exits during `ptah_run_check` — Tasks 9.1, 10.2
- Worktree outside every open folder; worktree without `node_modules/nx` — Task 9.2
- Codex lane with no rollout file — Task 11.1

## Batch rules for every executor (restate in every brief)

- R1 limit: stop at about 150k context or 60 tool calls. If you reach it, write a progress note (what is done, what is
  left, file:line) in your final message and return.
- Executors are subagents only (CLI lanes disabled). Executors never run git and never edit `batches.md` or `task.md`.
- Do not touch TASK_2026_609_c495 files: agent-generation services/templates, `.claude/agents`, the system-prompt parts
  of `sdk-query-options-builder.ts`.
- Real code only: no stubs, TODO markers or suppressions. Each item gets the regression test named in its task.
- Check output short (R5): tail or filter; judge by exit code, not by grepping coloured Nx output.
- Scoped checks for every batch (exit code 0 each):
  - `npx nx run-many -t typecheck,lint,test -p <the batch's projects>`
  - `npx nx run di-lint:lint`
  - `npx nx run degradation-audit:lint`
  - When a libs/shared type changes: typecheck every importer (`npx nx affected -t typecheck`, excluding `api-*`,
    `ptah-license-server`, `ptah-landing-page-e2e`).

---

# Phase 1 — Stage D (unblocked)

Phase review: one code-logic review (Opus) on the combined diff of Batches 1-7 after Batch 7 commits. No new public API
is planned; if Batch 4 exports `pushParentMessage` from the agent-sdk barrel, add a Sonnet style review.

## Batch 1: Capper, config provider and spool minors — IN_PROGRESS

- Recommended executor: backend-developer, model Sonnet (R4: mechanical)
- Fallback executor: backend-developer, model Opus
- Execution mode: sequential
- Rationale: three file-local fixes in two libs, no design call.
- Tasks: 3 | Depends on: none
- Phase: Stage D | Phase review: code-logic at phase end
- Closes: D.1 (A-M1), D.9 N2, D.9 N3, D.12 A-m7
- Projects: `@ptah-extension/agent-sdk`, `@ptah-extension/tool-output-reducers`

### Task 1.1: Read outline keeps the original line metadata (D.1) — IN_PROGRESS

- File: `D:/projects/ptah-extension/.claude-worktrees/task-597-s4/libs/backend/agent-sdk/src/lib/helpers/compaction/tool-output-capper.ts` (+ `tool-output-capper.spec.ts`)
- Evidence: `s4b-code-logic-review-a.md` M1; current code `tool-output-capper.ts:290-305` (`{ ...file, content: next }` copies `startLine`/`numLines`/`totalLines` unchanged), outline at `:312-370`.
- Change: on the whole-file outline path, set the `file` metadata to describe what is returned (`startLine: 1`, `numLines` = line count of the returned text; keep `totalLines` as the real file length), and make the trailer say the outline's line positions are not file line numbers ("read with offset/limit for exact lines"). The partial-read path (`capSlots`) is unchanged.
- Regression test: whole-file Read over budget → `numLines` equals the outline's line count, `totalLines` unchanged, trailer contains the "not file line numbers" text; a response whose `file` lacks those fields stays without them.
- Validation notes: do not invent fields the input did not have (spread only the keys that exist).

### Task 1.2: Type-checked defaults lookup and warn-once for invalid budgets (D.9 N2, D.12 A-m7) — IN_PROGRESS

- File: `.../libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts` (+ `.spec.ts`)
- Evidence: `s4b-code-logic-rereview.md` N2 (`compaction-config-provider.ts:148`, `as number` on `Record<string, unknown>`); review A m7 (warn on every `getConfig()`; called per tool call and per subagent message).
- Change: replace the cast with a guard (`Number.isSafeInteger(v) && v > 0`, else throw at construction or log an error once and use a local floor) so a missing platform-core key cannot become `undefined`; warn about an invalid hand-edited value once per key+value (a private `Set`), not on every call.
- Regression test: a spec that pins all four keys present and positive in `FILE_BASED_SETTINGS_DEFAULTS`; repeated `getConfig()` with one invalid value logs one warn.

### Task 1.3: Log non-EEXIST `.gitignore` failures in the spool (D.9 N3) — IN_PROGRESS

- File: `.../libs/backend/tool-output-reducers/src/lib/output-budget/spool.ts` (+ `spool.spec.ts`)
- Evidence: rereview N3; `spool.ts:181-184` catch says "degradation-audit: reported" but reports nothing.
- Change: in `ensureSpoolGitignore`, ignore `EEXIST`; report any other error through the module's existing reporting route (follow how `spool.ts` reports prune/write failures; if none exists, return the error code to the caller that already logs spool outcomes). Keep it fail-open. The comment must match what the code now does.
- Regression test: `EACCES` on the `.gitignore` write is reported once and the spool file is still written; `EEXIST` reports nothing.
- Validation notes: `degradation-audit:lint` checks these catch comments — run it.

### Batch 1 verification

- Files above exist with real changes; scoped checks pass for agent-sdk and tool-output-reducers plus di-lint and degradation-audit.

## Batch 2: Lane guard counts OpenCode shell calls; warn names the bad values — PENDING

- Recommended executor: backend-developer, model Sonnet
- Fallback executor: backend-developer, model Opus
- Execution mode: sequential
- Rationale: two file-local fixes in one lib.
- Tasks: 2 | Depends on: R1 resolved (the user's `lane-budget-guard.ts:141` edit committed first)
- Phase: Stage D | Phase review: code-logic at phase end
- Closes: D.4 (B-M3), D.9 N1
- Projects: `@ptah-extension/cli-agent-runtime`

### Task 2.1: Count `command` segments once per call (D.4) — PENDING

- File: `.../libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.ts` (+ `lane-budget-guard.spec.ts`)
- Evidence: `opencode-cli.adapter.ts:833-848` emits OpenCode `bash` as `type: 'command'` with `toolCallId`; the guard returns early for anything but `tool-call` (`lane-budget-guard.ts:78`).
- Change: count a `command` segment when it carries a `toolCallId` not already counted; remember counted ids (a bounded `Set`, cleared in `reset()`), so Codex's `tool-call` on start plus `command` on completion counts once. Repeat key for a command: `toolName` (the command line) as today's `callKey` fallback.
- Regression test: OpenCode-style `command` segments trip `stopAt`; a Codex-style `tool-call` + `command` with the same id count once; `reset()` clears the id set.
- Validation notes: keep the user's line-141 change. Do not change the adapter.

### Task 2.2: Fallback warn carries the rejected values (D.9 N1) — PENDING

- File: `.../libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts` (+ spec)
- Evidence: rereview N1; `agent-spawn-environment.service.ts:216-234` logs `d.steerAt`/`d.stopAt`/`d.repeatAt`, not `steer`/`stop`/`repeat`.
- Change: log the provided values (numbers as-is; non-numbers as their `typeof`) next to the defaults; warn once per distinct invalid tuple, not on every spawn.
- Regression test: an invalid pair logs the provided values; two spawns with the same invalid values log once.

### Batch 2 verification

- Scoped checks for cli-agent-runtime plus di-lint and degradation-audit pass.

## Batch 3: Executor release on normal end; effective TTL to the monitor; contextTokens honesty — PENDING

- Recommended executor: backend-developer, model Opus (R4: logic)
- Fallback executor: backend-developer, model Opus (fresh run)
- Execution mode: sequential
- Rationale: session lifecycle and option plumbing on the hot path.
- Tasks: 3 | Depends on: R1 resolved (the user's executor edits committed first)
- Phase: Stage D | Phase review: code-logic at phase end
- Closes: D.2 (A-M2), D.7 (28b / A-m3), D.12 B-m7
- Projects: `@ptah-extension/agent-sdk`

### Task 3.1: Release the tap when the stream ends without an abort (D.2) — PENDING

- File: `.../libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` (+ `session-query-executor.service.spec.ts`)
- Evidence: release only on abort (`:523-527`); `StreamTransformer`'s `finally` calls only `activityWatchdog.stop()` (`stream-transformer.ts:884`).
- Change: override `stop()` in `CompactionObservingWatchdog` (`:358-374`) to call `super.stop()` then `tap.release()` (idempotent). Keep the abort listener.
- Regression test: a run whose stream ends normally (no abort) leaves no coordinator record and no monitor session; a following resumed run registers afresh (R6).
- Validation notes: build on the user's edits at ~240-330; do not revert them. If Decision 1 becomes (b), Batch 15 moves this release to the transformer end callback.

### Task 3.2: Pass the effective subagent prompt-cache TTL to the monitor (D.7) — PENDING

- Files: `.../libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (+ its spec), the executor above
- Evidence: `subagent-budget-monitor.ts:228-232` already accepts `cacheTtl`; the executor calls `monitor.observe(id, message)` without it (`session-query-executor.service.ts:251`); the builder resolves `subagentTtl` at `:1166-1177`.
- Change: expose `subagentTtl.effective` on the builder's build result; the executor hands it to the tap (setter after `build()` at `:662`, since the tap exists before it) and the tap passes it as the third `observe` argument.
- Regression test: a 1h-effective session prices a message without `cache_creation` at weight 2; the default stays 5m when the builder reports nothing.
- Validation notes: touch only the TTL lines and the result type in the builder (R3).

### Task 3.3: Subagent `contextTokens` only when cache figures exist (D.12 B-m7) — PENDING

- File: `.../libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts` (+ spec)
- Evidence: `assistant-message.transformer.ts:380-383` sums `cache_read_input_tokens ?? 0` and `cache_creation_input_tokens ?? 0`, so a provider without cache figures shows `input` instead of "unknown" (`agent-monitor.store.ts:212-216` prefers the backend value).
- Change: emit `contextTokens` only when both cache fields are numbers; otherwise omit it so the frontend fallback applies.
- Regression test: message without cache fields → no `contextTokens`; with both → the sum.

### Batch 3 verification

- Scoped checks for agent-sdk plus di-lint and degradation-audit pass.

## Batch 4: Subagent stop path — task text, ordered push, retry, listener errors — PENDING

- Recommended executor: backend-developer, model Opus
- Fallback executor: backend-developer, model Opus (fresh run)
- Execution mode: sequential
- Rationale: three coupled changes to the stop/handoff path.
- Tasks: 3 | Depends on: Batch 3 (same lib; avoids concurrent agent-sdk edits)
- Phase: Stage D | Phase review: code-logic at phase end
- Closes: D.8 (28a, A-m2, A-m9, FM6), D.12 A-m6 (monitor side)
- Projects: `@ptah-extension/agent-sdk`

### Task 4.1: Handoff carries the task text; bounded stop retry; monitor rekey (D.8, A-m6) — PENDING

- File: `.../libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts` (+ spec)
- Evidence: `handoffMessage` (`:456-477`) has no task text; `stopFired = true` before the attempt and no retry (`:370-385`).
- Change: (1) in `observe`, record the `description` (else the first 300 chars of `prompt`) from a parent assistant `tool_use` whose id matches a subagent `toolCallId` (verify the `Agent`/`Task` input names); include it, capped, in `handoffMessage`. (2) On `stopSubagent` failure, leave `stopFired` false and count attempts; retry on the next subagent message up to 2 more times, then log once and give up (R7). (3) Add `rekey(fromSessionId, toSessionId)` that moves a session's state (used by Batch 5).
- Regression test: handoff text includes the task description; a rejected stop is retried on the next message and stops after the cap; `rekey` moves state.

### Task 4.2: Parent push through the dispatcher's ordering lock and `origin` (D.8, A-m2) — PENDING

- File: `.../libs/backend/agent-sdk/src/lib/helpers/subagent-message-dispatcher.ts` (+ spec); monitor above
- Evidence: `serialisedPush` (`:95`) and `origin` (`:205`) are used only by `sendToSubagent`; the monitor pushes with its own `streamInput` (`subagent-budget-monitor.ts:418-454`).
- Change: add `pushParentMessage(sessionId, content)` on the dispatcher that uses `serialisedPush`, the same `origin` and the same send timeout; the monitor calls it and its private `streamParentMessage` is deleted.
- Regression test: a steer and a monitor handoff pushed in the same tick reach `streamInput` in call order.

### Task 4.3: Coordinator listener errors are logged, not rethrown (D.8, A-m9) — PENDING

- File: `.../libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.ts` (+ spec)
- Evidence: `compaction-coordinator.ts:283-293` rethrows through `queueMicrotask`; the class is built with `new CompactionCoordinator()` in `di/register.ts:437`.
- Change: take an optional `onListenerError(error, change)` (or a logger-like `{ warn }`) in the constructor; default logs nothing fatal; `register.ts` passes the SDK logger. A failing listener still never undoes the transition or skips the others.
- Regression test: a throwing listener → the other listener still runs, the error goes to the callback, no uncaught exception.
- Validation notes: `register.ts` is a DI file — run di-lint.

### Batch 4 verification

- Scoped checks for agent-sdk plus di-lint and degradation-audit pass. If `pushParentMessage` leaves the barrel, flag it for the style review.

## Batch 5: PostCompact rekey for port and monitor; time-bounded PostToolUse cap — PENDING

- Recommended executor: backend-developer, model Opus
- Fallback executor: backend-developer, model Sonnet
- Execution mode: sequential
- Rationale: hook wiring that depends on Batch 4's `rekey`.
- Tasks: 2 | Depends on: Batch 4
- Phase: Stage D | Phase review: code-logic at phase end
- Closes: D.12 A-m6, D.12 A-m8
- Projects: `@ptah-extension/agent-sdk`

### Task 5.1: Rekey the context-usage port and the monitor on PostCompact (A-m6) — PENDING

- Files: `.../libs/backend/agent-sdk/src/lib/helpers/compaction/context-usage.port.ts` (+ spec), `.../libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts` (+ spec)
- Evidence: only the coordinator is rekeyed (`compaction-hook-handler.ts:488`); the port's `lastReadings` and the monitor's sessions keep the old id.
- Change: add `rekey(from, to)` to the port (refuse-overwrite like the coordinator); the hook handler calls port and monitor rekey next to `coordinator.onPostCompact`, each fail-open with one warn. Resolve the monitor/port optionally, as the handler resolves the coordinator.
- Regression test: after PostCompact, `getLast(newId)` returns the last reading; an in-flight read for the old id does not resurrect it.

### Task 5.2: Bound the PostToolUse cap and honour the abort signal (A-m8) — PENDING

- File: `.../libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts` (+ spec)
- Evidence: `post-tool-use-hook-handler.ts:69-72, 100-125` awaits the capper with no time bound and ignores `options.signal`.
- Change: race the cap against a bound (a named constant well under the SDK hook timeout) and the signal; on timeout or abort return the original output (fail-open) and log once.
- Regression test: a capper that never resolves → the original output after the bound; an aborted signal → original output at once.

### Batch 5 verification

- Scoped checks for agent-sdk plus di-lint and degradation-audit pass.

## Batch 6: Fresh rotation handoff; advice noise; atomic lane-guard writes — PENDING

- Recommended executor: backend-developer, model Opus
- Fallback executor: backend-developer, model Sonnet
- Execution mode: sequential
- Rationale: D.6 is logic; the two Minors are small and live in rpc-handlers.
- Tasks: 3 | Depends on: none (file-disjoint from 1-5); run after Batch 5 to keep one agent-sdk writer at a time
- Phase: Stage D | Phase review: code-logic at phase end
- Closes: D.6 (B-M6), D.12 B-m3, D.12 B-m6
- Projects: `@ptah-extension/agent-sdk`, `@ptah-extension/rpc-handlers`

### Task 6.1: Rotation never reuses a stale handoff copy (D.6) — PENDING

- File: `.../libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts` (+ spec)
- Evidence: `previewHandoff` returns `entry.handoffCopy` whenever one exists (`:696-711`); it may predate an extend.
- Change: stamp the copy with the snapshot it was built from (or `builtAt`), and reuse it only when no newer usage snapshot was observed since; otherwise build afresh (not written). The handoff-stage preview behaves the same.
- Regression test: write handoff → observe a newer snapshot → preview returns a newly built copy; with no new snapshot it returns the kept copy.

### Task 6.2: "advice: fresh" instruction only when an agent is advised fresh (B-m3) — PENDING

- File: `.../libs/backend/rpc-handlers/src/lib/chat/session/chat-subagent-context-injector.service.ts` (+ spec)
- Evidence: review B m3 (`:191, :219`). Current `:191` is `agents.some((a) => a.advice !== undefined)` — first confirm whether `advice` is set for every agent; if the instruction is already added only when an agent is marked fresh, close the item with a spec that pins it and no code change.
- Regression test: no fresh agent → no instruction.

### Task 6.3: Steer/stop pair written in one step (B-m6) — PENDING

- File: `.../libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` (+ spec)
- Evidence: review B m6 (`agent-rpc.handlers.ts:519-524` at review time; now the `setAgentCfg` calls near `:495-512`).
- Change: when both `laneToolCallSteerAt` and `laneToolCallStopAt` are in one request, write them through a single settings update if the store supports a multi-key write; else write the value that keeps the stored pair valid first (raise stop before steer, lower steer before stop), so no in-between state is invalid.
- Regression test: raising both values never leaves `stop <= steer` stored between the writes.

### Batch 6 verification

- Scoped checks for agent-sdk and rpc-handlers plus di-lint and degradation-audit pass.

## Batch 7: CLI host binds the code outliner — PENDING

- Recommended executor: backend-developer, model Sonnet
- Fallback executor: backend-developer, model Opus
- Execution mode: sequential
- Rationale: one composition-root binding, same as the VS Code and Electron hosts.
- Tasks: 1 | Depends on: R2 — the concurrent CLI/Electron DI fix is committed; re-read `container.ts` first
- Phase: Stage D (last batch; triggers the phase review) | Phase review: code-logic at phase end
- Closes: D.10
- Projects: `@ptah-extension/cli-engine`

### Task 7.1: Bind `SDK_CODE_OUTLINER` in the CLI container (D.10) — PENDING

- File: `.../libs/backend/cli-engine/src/lib/container.ts` (+ a container spec next to the existing `container-*.spec.ts`)
- Pattern to follow: `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:156-158` and `apps/ptah-electron/src/di/phase-2-libraries.ts:205-207` (lazy factory `new TreeSitterCodeOutliner(c.resolve(TOKENS.TREE_SITTER_PARSER_SERVICE))`).
- Change: register the same factory after workspace-intelligence (`container.ts:636`) and before the capper is first resolved; import `TreeSitterCodeOutliner` from `@ptah-extension/vscode-lm-tools` (already a dependency).
- Regression test: the built CLI container resolves `SDK_TOKENS.SDK_CODE_OUTLINER` to a `TreeSitterCodeOutliner`.
- Validation notes: do not edit anything the concurrent DI fix changed.

### Batch 7 verification

- Scoped checks for cli-engine plus di-lint and degradation-audit pass. Then the Stage D phase review is due.

---

# Phase 2 — Stage E (unblocked)

Phase review: one code-logic review (Opus) on the combined diff of Batches 8-11 after Batch 11 commits. New optional
`signal` parameters on `waitForAgents`/`runCheck` are public API → add a Sonnet style review.

## Batch 8: Cancellable waits (E.3) — PENDING

- Recommended executor: backend-developer, model Opus
- Fallback executor: backend-developer, model Opus (fresh run)
- Execution mode: sequential
- Rationale: listener/timer lifecycle across two libs.
- Tasks: 3 | Depends on: none (run after Phase 1, or in parallel with Batch 1 only if the orchestrator wants; file-disjoint)
- Phase: Stage E | Phase review: code-logic + style
- Closes: E.3 (S4-a M5)
- Projects: `@ptah-extension/cli-agent-runtime`, `@ptah-extension/vscode-lm-tools`

### Task 8.1: `waitForAgents` accepts an `AbortSignal` — PENDING

- File: `.../libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` (+ the wait spec)
- Evidence: `waitForAgents` at `:1177`, no cancellation; clamp at `:1185`.
- Change: optional `signal`; an already-aborted signal returns at once; abort removes the listener and the timer and resolves with the partial result (status as on timeout, marked cancelled). No behaviour change without a signal.
- Regression test: abort mid-wait → resolves promptly, no listener left (`listenerCount` back to the baseline).

### Task 8.2: `runAgentWait` forwards a signal from its dependencies — PENDING

- File: `.../libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-wait.tool.ts` (+ spec)
- Change: optional `signal` on the dependency/args input, passed to `waitForAgents`; the reply says "wait cancelled" when it fired.
- Regression test: an aborted signal yields the cancelled summary.

### Task 8.3: `ptah.agent.waitFor` ends with its `execute_code` call — PENDING

- File: `.../libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts` (+ spec)
- Evidence: `waitFor` defaults to `MAX_AGENT_WAIT_MS` (`:476-499`) while `execute_code` stops at 30 s.
- Change: find the `execute_code` run's cancellation/timeout hook and pass it as the signal to `waitFor`/`waitForAgents`. If no such hook exists, stop and report it in the progress note (do not lower the default).
- Regression test: an `execute_code`-style abort ends the pending `waitFor` and removes its listener.

### Batch 8 verification

- Scoped checks for cli-agent-runtime and vscode-lm-tools plus di-lint and degradation-audit pass.

## Batch 9: `run_check` cancel/dispose kill, description and constants (E.2 core, E.5, E.6) — PENDING

- Recommended executor: backend-developer, model Opus
- Fallback executor: backend-developer, model Sonnet
- Execution mode: sequential
- Rationale: process-tree lifecycle plus mechanical text/constant fixes in the same two files (each file lands once).
- Tasks: 3 | Depends on: none
- Phase: Stage E | Phase review: code-logic + style
- Closes: E.2 (tool side), E.5 RM1/RM2, E.6 SM1/SM2
- Projects: `@ptah-extension/vscode-lm-tools`

### Task 9.1: Kill the Nx tree on cancel and on host dispose (E.2) — PENDING

- File: `.../libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/run-check.tool.ts` (+ spec)
- Evidence: `detached: process.platform !== 'win32'` (`:372-374`); no abort path in `execute`.
- Change: optional `signal` in `RunCheckDependencies`/input; on abort, kill the tree with the existing `killTree` and settle with a "cancelled" verdict. Keep a module-level set of live check PIDs and export `killRunningChecks(): Promise<void>` for host dispose (wired in Batch 10). Only the cancelled call's PID is killed (R8).
- Regression test: abort → `killTree` called with the child PID, verdict "cancelled", PID removed from the set; `killRunningChecks` kills every live PID.

### Task 9.2: Description and Nx-missing text (E.5) — PENDING

- File: run-check tool above
- Evidence: description says "(worktrees too)" (`:132`) while HTTP refuses a worktree outside every open folder (`protocol-dispatcher.ts:3466-3480`); "Nx was not found" (`:192`) gives no hint for a worktree without `node_modules`.
- Change: description states "worktrees inside an open workspace folder"; the Nx-missing message adds "a worktree needs its own install or a node_modules link".
- Regression test: spec asserts both strings.

### Task 9.3: One wait ceiling and no `openWorldHint` (E.6) — PENDING

- Files: `.../mcp-core/wait-tools-args.schema.ts` (+ spec), run-check tool above
- Evidence: `wait-tools-args.schema.ts:19` `MAX_WAIT_TIMEOUT_SEC = 900` vs `agent-process-manager.service.ts:153` `MAX_AGENT_WAIT_MS = 900_000`; `run-check.tool.ts:163` `openWorldHint: false`.
- Change: `MAX_WAIT_TIMEOUT_SEC = MAX_AGENT_WAIT_MS / 1000` imported from `@ptah-extension/cli-agent-runtime`; annotations become `{ destructiveHint: false }`.
- Regression test: spec pins `MAX_WAIT_TIMEOUT_SEC * 1000 === MAX_AGENT_WAIT_MS`.

### Batch 9 verification

- Scoped checks for vscode-lm-tools plus di-lint and degradation-audit pass.

## Batch 10: Request abort plumbing for HTTP and stdio; dispose kill wiring — PENDING

- Recommended executor: backend-developer, model Opus
- Fallback executor: backend-developer, model Opus (fresh run)
- Execution mode: sequential
- Rationale: transport-level cancellation shared by both tools.
- Tasks: 2 | Depends on: Batches 8 and 9
- Phase: Stage E | Phase review: code-logic + style
- Closes: E.2 (request cancel + host exit), E.3 (MCP cancel)
- Projects: `@ptah-extension/vscode-lm-tools`

### Task 10.1: Abort signal in the MCP request context — PENDING

- Files: `.../mcp-core/mcp-request-context.ts` (+ spec), `.../mcp-http/http-server.handler.ts` (+ spec), `.../mcp-core/protocol-dispatcher.ts`, `.../mcp-stdio/agent-tool.dispatcher.ts`
- Evidence: `McpRequestContext` has no signal (`mcp-request-context.ts:22`); `runAgentWait` / `runCheck` calls at `protocol-dispatcher.ts:1341, 1369` and `agent-tool.dispatcher.ts:740, 791`; stdio already handles `notifications/cancelled` (`stdio-mcp-server.service.ts:241-255`).
- Change: add an optional `signal` to the context; the HTTP handler aborts it when the request/response closes before the reply; the stdio cancel path aborts the matching request's controller if it can reach it (otherwise record that stdio cancel is not wired and why). Both dispatchers pass the signal to `runAgentWait` and `runCheck`.
- Regression test: HTTP request closed mid-`run_check` → `killTree` called; mid-`agent_wait` → listener removed.

### Task 10.2: Kill live checks on host dispose — PENDING

- File: `.../mcp-http/http-mcp-server.service.ts` (dispose at `:699-704`) or the stdio server's shutdown, whichever owns the tool lifetime
- Change: call `killRunningChecks()` on dispose/disposeAsync, fail-open with one warn.
- Regression test: dispose with a live check → its PID killed.

### Batch 10 verification

- Scoped checks for vscode-lm-tools plus di-lint and degradation-audit pass.

## Batch 11: Codex lane without a rollout figure (E.1) — PENDING

- Recommended executor: backend-developer, model Sonnet
- Fallback executor: backend-developer, model Opus
- Execution mode: sequential
- Rationale: one decision rule in one file.
- Tasks: 1 | Depends on: none (file-disjoint); last batch of Stage E → triggers the phase review
- Phase: Stage E | Phase review: code-logic + style
- Closes: E.1 (S4-a M3)
- Projects: `@ptah-extension/cli-agent-runtime`

### Task 11.1: No turn-sum fallback for Codex — PENDING

- File: `.../libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts` (+ spec)
- Evidence: `lane-resume-gate.ts:110-131` falls back to the streamed figure, which for Codex is the `turn.completed` sum (R9.1 says it shall never be used).
- Change: for `cli === 'codex'` with no rollout figure (missing or unreadable), set tokens to `null` (unknown) and decide on idle time only; keep the `note`.
- Regression test: Codex, no rollout, streamed 120k, idle 2 min → resume; idle 11 min → fresh.

### Batch 11 verification

- Scoped checks for cli-agent-runtime plus di-lint and degradation-audit pass. Then the Stage E phase review is due.

---

# Phase 3 — Decision-gated batches

Phase review: one code-logic review on the combined diff after the last of Batches 12-15 that runs; a visual review
with before/after screenshots (dark + light) for Batch 13.

## Batch 12: Subagent stop off switch (D.3) — BLOCKED_ON_DECISION (Decision 2)

- Recommended executor: backend-developer, model Opus
- Fallback executor: backend-developer, model Sonnet
- Execution mode: sequential
- Tasks: 1 | Depends on: Decision 2, Batches 1 and 4 (same files)
- Phase: Decisions | Phase review: code-logic
- Closes: D.3 (A-M4)

### Task 12.1: Gate the stop — BLOCKED_ON_DECISION

- Files (option a): `subagent-budget-monitor.ts` (+ spec). Option b/c add `libs/backend/platform-core/src/file-settings-keys.ts`, `compaction-config-provider.ts`, the `CompactionConfig` type and the RPC settings types (typecheck all importers).
- Evidence: `subagent-budget-monitor.ts:257-270` reads only the two thresholds.
- Change: when the switch is off, keep counting but never call `stop`; log once per session that the stop is disabled.
- Regression test: switch off → over-budget subagent is not stopped, snapshot still reports `budgetReached`.

## Batch 13: "Keep this session" survives remounts (D.5) — BLOCKED_ON_DECISION (Decision 3)

- Recommended executor: frontend-developer, model Sonnet (option a) / Opus (option b)
- Fallback executor: frontend-developer, model Opus
- Execution mode: sequential
- Tasks: 1 | Depends on: Decision 3; Batch 6 if option b (same `session-budget.service.ts`)
- Phase: Decisions | Phase review: code-logic + visual (before/after, dark + light, captured from the base commit)
- Closes: D.5 (B-M5)

### Task 13.1: Move kept keys out of the banner — BLOCKED_ON_DECISION

- Files (option a): new `libs/frontend/chat/src/lib/services/session-rotation-keep.store.ts` (+ spec; check the folder convention first), `.../molecules/notifications/session-budget-banner.component.ts` (+ spec).
- Evidence: `session-budget-banner.component.ts:196, 199-212, 275-280`; `chat-view.component.html:136`.
- Change: the store holds `sessionId:threshold` keys, forgets a session's keys when its advisory clears (the effect moves with it); the banner reads and writes the store.
- Regression test: keep → destroy and recreate the banner → rotation stays hidden; advisory cleared → keys dropped.

## Batch 14: Resume gate on Ptah CLI resumes; blocked-model check there (E.4, D.12 B-m2) — BLOCKED_ON_DECISION (Decision 4)

- Recommended executor: backend-developer, model Opus
- Fallback executor: backend-developer, model Opus (fresh run)
- Execution mode: sequential
- Tasks: 2 | Depends on: Decision 4; Batch 8 (same manager and builder files)
- Phase: Decisions | Phase review: code-logic
- Closes: E.4 (S4-a M6), D.12 B-m2 (`spawnFromSdkHandle` part)

### Task 14.1: Gate `spawnFromSdkHandle` resumes — BLOCKED_ON_DECISION

- Files: `.../namespace-builders/agent-namespace.builder.ts` (+ spec), `.../cli-agents/agent-process-manager.service.ts` (+ spec)
- Evidence: `agent-namespace.builder.ts:282-318` resumes via `spawnFromSdkHandle` (`agent-process-manager.service.ts:622`) without `gateResume` (`:353, :381`).
- Change: run the gate before the handle is created (expose it through the manager), carry `resumeDecision` on the result; under option (a) add a doc comment on `continueConversation` (`:1574`) saying why it is ungated; under (b)/(c) apply or report the gate there.
- Regression test: Ptah CLI resume over 60k → fresh with `resumeDecision` surfaced.

### Task 14.2: Blocked-model check on `spawnFromSdkHandle` (B-m2) — BLOCKED_ON_DECISION

- File: manager above
- Evidence: `findBlockedLaneModel` only in `doSpawnSdk` (`:492`).
- Change: run the same check in `spawnFromSdkHandle` before the handle starts; a model left to the CLI default stays unchecked (recorded).
- Regression test: blocked model on the Ptah CLI path → `LaneModelBlockedError`.

## Batch 15: 27b message tap (D.11) — BLOCKED_ON_DECISION (Decision 1)

- Recommended executor: backend-developer, model Sonnet (option a) / Opus (option b)
- Fallback executor: backend-developer, model Opus
- Execution mode: sequential
- Tasks: 1 | Depends on: Decision 1; Batch 3 (same executor file)
- Phase: Decisions | Phase review: code-logic
- Closes: D.11, D.12 A-m1

### Task 15.1: Pin or refactor the tap — BLOCKED_ON_DECISION

- Option a: `session-query-executor.service.spec.ts` only — a real `StreamTransformer` feeding the watchdog; assert the tap sees `result`, `status: 'compacting'`, `compact_boundary`.
- Option b: `stream-transformer.ts` (+ spec), `session-lifecycle-manager.ts`, `sdk-agent-adapter.ts`, `session-query-executor.service.ts` (+ spec): an explicit `onMessage` callback and an end callback; delete `CompactionObservingWatchdog`'s `observe` override and move Task 3.1's release to the end callback.

---

## D.12 — S4-b Minors: disposition

| Source | Minor | file:line | Disposition |
| --- | --- | --- | --- |
| Review A | m1 tap through a watchdog subclass | `session-query-executor.service.ts:358-374` | D.11, Batch 15 |
| Review A | m2 handoff push outside `serialisedPush`, no `origin` | `subagent-message-dispatcher.ts:95, 205` | Task 4.2 |
| Review A | m3 omitted effective TTL | `subagent-budget-monitor.ts:228-232`; executor `:251` | Task 3.2 (D.7) |
| Review A | m4 26b catch restructure | `context-usage.port.ts:151-162` | No change needed (reviewer) |
| Review A | m5 stopped subagent becomes `completed` | `subagent-budget-monitor.ts:387-391`; `subagent-registry.service.ts:310-328` | Recorded, not fixed here: a `stopped` status changes the libs/shared `SubagentStatus` union and registry semantics; named later task |
| Review A | m6 PostCompact rekey covers only the coordinator | `compaction-hook-handler.ts:488`; port `lastReadings`; monitor `sessions` | Tasks 4.1 + 5.1 |
| Review A | m7 `getConfig()` warn on every call | `compaction-config-provider.ts:145-159` | Task 1.2 |
| Review A | m8 PostToolUse cap unbounded, ignores signal | `post-tool-use-hook-handler.ts:69-72, 100-125` | Task 5.2 |
| Review A | m9 listener errors rethrown via `queueMicrotask` | `compaction-coordinator.ts:283-293` | Task 4.3 (D.8) |
| Review A | note: ARMED never consumed | `compaction-coordinator.ts:195-206` | Recorded for the Stage C E2 follow-up |
| Review B | m1 `LaneModelBlockedError` not exported | `cli-agents/index.ts:13` | Resolved in the S4-b fix round |
| Review B | m2 blocked-model check skips `spawnFromSdkHandle` / CLI default model | `agent-process-manager.service.ts:492, 622` | Task 14.2 (handle path); CLI default recorded |
| Review B | m3 `hasAdvice` adds the fresh instruction for every agent | `chat-subagent-context-injector.service.ts:191, 219` | Task 6.2 |
| Review B | m4 rotation hides OK/Restore over `tighten` | `session-budget-banner.component.ts:219-228` | Accepted by the reviewer; Batch 13 makes Keep reliable |
| Review B | m5 focus ring on `btn-primary` (light) | `session-budget-banner.component.ts:76, 113` | Resolved in the S4-b fix round |
| Review B | m6 steer and stop writes not atomic | `agent-rpc.handlers.ts:495-512` | Task 6.3 |
| Review B | m7 `contextTokens` `?? 0` shows `input` without cache figures | `assistant-message.transformer.ts:380-383` | Task 3.3 |
| Style | tokens JSDoc carries TASK ids | `agent-sdk/src/lib/di/tokens.ts:57-84` | Cosmetic; recorded, no change |
| Style | `CompactionState` const + type of one name | `compaction-state.types.ts:24, 34` | Matches `SessionBudgetStage`; no change |
| Style | `I` prefix only on `IContextUsagePort` | `context-usage.port.ts` | Note only (port at a real boundary); no change |

## Next action

Orchestrator: before Batch 2 or 3, commit the user's Sonar edits in `session-query-executor.service.ts` and
`lane-budget-guard.ts` (R1). Run Batch 1 now with backend-developer (Sonnet), using the batch executor prompt and the
R1 limit. Put Decisions 1-4 to the user; Batches 12-15 stay BLOCKED_ON_DECISION until then.

---

## Stage F + G batches

Scope: Stage F (F.1-F.6) and Stage G (G.1-G.8) from `context.md`. Decomposed 2026-10-05 against `origin/main`
55f245619 (Stage D + E merged, PR #650). `<R>` = `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g`; every
path below is absolute under it.

Total tasks: 56 | Batches: 21 (16-36) | Complete: 0/21 (Batch 21 COMPLETE; 34 dropped; 24A added)
Ready now: Batches 16-33 (decisions recorded in context.md, User Decisions Stage F + G) | DROPPED: Batch 34 (G-C deferred as a named later task) | Batch 24A added (Task 21.2) | F.2 group (last, alone): Batches 35-36

### Plan validation (Stage F + G)

Status: PASSED WITH RISKS

Re-validation against the current code (file:line on 55f245619):

| Item | State | Evidence |
| --- | --- | --- |
| F.1 M1 restore shape | STILL PRESENT | `session-control.service.ts:815-835` returns `{applied: true, reason: 'failed'}`; doc `session-budget.types.ts:48-51`; `restoreWindow` `session-budget.service.ts:676-696` branches on `reason === 'failed'` |
| F.1 M3 read failure invisible | STILL PRESENT | `SessionBudgetHandoff` `session-budget.types.ts:55-66` has only `writeError`; `buildHandoff` `session-budget.service.ts:587-624` only WARNs `readError` (615-622) |
| F.1 M4 v4-only UUID | STILL PRESENT, consistent | `UUID_REGEX` now in `branded.types.ts:39-40`; used by `session-budget-rpc.schema.ts:26`, `session-handoff-writer.ts:60, 76-81` and `chat-rpc.schema.ts:46-51, 73`, so the gate and the actions agree |
| F.1 M5 actions without entry | STILL PRESENT | `act` `session-budget.service.ts:237-267`; `writeHandoffAction` 698-704; `previewHandoff` 711-729 |
| F.1 M6 `resolvedSessionBudget` | STILL PRESENT | `chat-view.component.ts:937-942` (`?? -1` at 941); `_budgetActionState` set only at 1357, never cleared |
| F.1 M7 resurrection / no release | STILL PRESENT | `entryFor` 752-772 called by `recordCompaction` 204-209, `accept` catch 287-305, `acceptOrThrow` 311; idle `evictStale` `session-registry.service.ts:583-599`; spawner `session-spawner.service.ts:717-731, 1296-1302` |
| F.1 M8 `/compact` exemption | PARTLY MITIGATED | limit copy `session-budget-banner.component.ts:331-334` says "/compact and /clear still work"; tighten copy 298-309 still suggests `/compact`; exact match `chat-session.service.ts:167-175` |
| F.2 sizes | GREW | `chat-view.component.ts` 1775 lines (budget signals 925-958, `onBudget*` 1271-1342, `runBudgetAction` 1344-1376); `session-stats-summary.component.ts` 1097 lines |
| F.3 sibling draft / write timeout | STILL PRESENT | `session-budget-settings.component.ts:438-442` nested commit; `:508-512` `settings:set` without timeout (read passes one at 365) |
| F.4 `canSend` and `enabled` | PARTLY FIXED | Blocking half fixed: `SessionBudgetService.canSend` (`session-budget.service.ts:221-234`) reads `getConfig()` every call, so sends go through once `enabled` is off. Residual: no settings feed to the frontend; the limit banner stays until the next snapshot (`tab-manager.service.ts:143-152, 2271`) |
| F.5 M1 | STILL PRESENT | `subagent-registry.service.ts:654-668` |
| F.5 M2 | STILL PRESENT | `agent-monitor.store.ts:1963-1993` |
| F.5 M3 | STILL PRESENT | `pricing.utils.ts:410-413`; store `sumRequestUsage` 196-225 (last model at 211), cost 287-295 |
| F.5 M4 | STILL PRESENT | `resolveParentSessionId` `agent-monitor.store.ts:1677-1709` skips `_pendingBackgroundIdentity` (630-633) |
| F.5 M5 | PARTLY FIXED | `forceClearSessionAgents` 1636-1661 drops pending identities; `clearSessionAgents` 1624-1631 does not; no cap |
| F.5 B1 | STILL PRESENT | `subagent-hook-handler.ts:259` registers only with `toolUseId`; else-branch 278-292 WARNs |
| F.6 Minors | STILL PRESENT (`.tmp` partly) | tooltip `session-stats-summary.component.ts:991`; preview chat-view 927-930/1282 + banner 162; `.tmp` `session-handoff-writer.ts:119-122` vs 76-81; `keepPreviousFigure` `session-budget-stage.ts:234-256`; re-export `agent-sdk/src/index.ts:83`; fixture `settings.fixtures.ts:248` |
| G.1 | STILL PRESENT | `compaction-config-provider.ts:113-130, 196-220`; `budgetDefault` 40-48 runs per call |
| G.2 (+FM-6, rereview m1/m3) | STILL PRESENT | `subagent-budget-monitor.ts` `rekey` 358-384, `sessionState` 391-404, retry 326, `onStopFailed` 577-603, m1 534-535 |
| G.3 | STILL PRESENT | `run-check.tool.ts:424` (no `onError`), 489-495, verdict text 321/325, pid delete 468; `killProcessTree(pid, signal, onError?)` `process-tree-reaper.ts:54-58` |
| G.4 | STILL PRESENT | VS Code `main.ts:160-170` awaits before `disposeAll` (176); Electron `shutdown.ts:195-198` `void`, `requiresDeferredDisposal` 379-381 ignores checks; JSDoc `run-check.tool.ts:387-395` |
| G.5 | CODE OK, TESTS MISSING | `mcp-serve.ts:363-367, 463-466`; `mcp-serve.spec.ts:197` mock only |
| G.6 | STILL PRESENT | `agent-rpc.handlers.ts:1068-1074`; result type `rpc.types.ts:1343` |
| G.7 | STILL PRESENT | `SubagentStopPort` `subagent-budget-monitor.ts:240-244`, spec :19, :112; not in a barrel |
| G.8 Minors | STILL PRESENT (keep pruning partly) | per task below; `SubagentStatus` `subagent-registry.types.ts:18-23` (3 non-spec users) |
| G.8 Batch 13 screenshots | MOVED | Stage C QA session; not batched here |

ALREADY FIXED and dropped: none in full. F.4's blocking half is fixed (above); only the stale banner remains (Decision F-D).

Assumptions:

- A1 F.1 M4: Claude Agent SDK session ids are v4 UUIDs (`crypto.randomUUID`). Unverified; Task 17.4 checks the SDK
  source in `node_modules` and either documents and pins v4 or relaxes `UUID_REGEX` to any RFC 4122 version.
- A2 F.6 tooltip: the chip can get the configured `tightenPercent`/`handoffPercent` from `SessionBudgetState`.
  Unverified; Task 33.6 checks it. If the state lacks them, the executor stops and reports (a shared type change then
  goes to the team-leader).
- A3 F.1 M7: the headless child stop path can reach a "release the budget entry" seam without a new cli-agent-runtime →
  agent-sdk import. Task 16.3 verifies; if not, the executor stops and reports.
- A4 F.3: the intended rule is "only a blurred sibling draft is committed"; the cross-field re-validation stays.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| B16 (M7 release) and B22 (executor/adapter tap) both touch `sdk-agent-adapter.ts` release paths | MEDIUM | B22 depends on B16; never in the same group |
| Shared type changes (B25 `rpc.types.ts`, B28 `session-budget.types.ts`, B32 `pricing.utils.ts`, B34 `SubagentStatus`) | MEDIUM | Those batches run `nx affected -t typecheck` (exclusions below), not only `-p` |
| B25 makes `AgentWaitResult.cancelled` required; construction sites may sit in vscode-lm-tools (B23 territory) | LOW | B25 runs after B23 |
| F.2 refactor collides with every chat-view / stats-chip edit | HIGH | F.2 (B35-36) runs last and alone, after B19 and B33 commit |
| Electron shutdown has no spec file | LOW | B29 adds one (or uses the nearest activation spec) |
| `agent-rpc.handlers.ts` has no spec | LOW | B25 adds `agent-rpc.handlers.spec.ts` for the new behaviour only |
| Load flakes (`session-handoff-writer.spec.ts`, `subagent-message-dispatcher.spec.ts`) | LOW | Re-run alone before calling a check failed |

Edge cases:

- Release, then a late result or compaction for the same id must not recreate the entry — Task 16.2.
- PostCompact alias: an old-id message after `release` must not resurrect state through the alias — Task 22.1.
- Kill failure on Windows when the root has exited but grandchildren hold pipes — Task 21.1.
- Cancelled stdio request: no response written; a duplicate in-flight id must not orphan the first controller — Tasks
  21.2, 21.3.
- Pending identity under a placeholder tab id that never gets `agent_start` — Tasks 20.2, 20.3.

### Decisions for the user

Batches that need an answer stay `PENDING DECISION`. Recommendation in bold.

- **F-A (F.1 M1) — shape of a failed window restore.** (a) Add a dedicated `restore-failed` reason to
  `SessionBudgetWindowReason`, return `{applied: true, reason: 'restore-failed'}`, update `restoreWindow` and the doc.
  (b) Keep the value; change the shared doc to allow `reason` with `applied: true`. (c) Return
  `applied: false, reason: 'failed'`. **Recommend (a)**: the type stays truthful and no consumer has to guess. (Batch 28)
- **F-B (UI text) — new and changed copy.** Proposed: M3 banner warning "The transcript could not be read; the handoff
  may be incomplete."; preview failure "Could not load the handoff. Try again."; tooltip built from the configured
  percents ("At {tighten}%… {handoff}%… 100%"); M8 copy "/compact frees context but does not reset this session's
  budget; at the limit only a bare /compact is allowed." (a) Accept as proposed. (b) Supply your own wording.
  **Recommend (a)**: plain and matches the banner's tone. (Batch 33)
- **F-C (F.1 M8) — `/compact` at the limit.** (a) Copy only (F-B text); keep the exact-match exemption. (b) Also allow
  `/compact <instructions>` (prefix match). (c) Accept, no change. **Recommend (a)**: the measure is cumulative, so the
  honest fix is the words, not a wider bypass. (Batch 33)
- **F-D (F.4 residual) — limit banner after the budget is turned off.** Sends already go through. (a) When the settings
  card saves `sessionBudget.enabled = false`, clear `sessionBudget` on every open tab locally. (b) Add a push or RPC so
  each tab re-reads its budget state after any budget setting change. (c) Accept; the next result refreshes it.
  **Recommend (a)**: covers the reported case with no new backend contract (a raised limit still waits for the next
  snapshot). (Batch 33)
- **F-E (F.5 M3) — cost estimate.** (a) Price each request with its own model; when cache tokens exist and the model has
  no cache price, the cost is unknown (null), not 0. (b) Per-request model, keep 0 for a missing cache price, add an
  "estimate" note. (c) Accept (already labelled an estimate). **Recommend (a)**: N6 rule "missing is never 0".
  `pricing.utils.ts` is shared. (Batch 32)
- **F-F (F.5 B1) — binding `agentId` when SubagentStart has no `toolUseId`.** (a) Exact `agentId:` match only, as
  recorded in TASK_2026_597 Batch 47a (bind when the Task tool result names that exact id). (b) Bind to the single
  pending Task tool_use of the parent session without an `agentId`, only when exactly one candidate exists. (c) Keep
  log-only. **Recommend (a)**: already the recorded approach, no guessing. (Batch 31)
- **G-A (G.4) — one shutdown contract for `killRunningChecks`.** (a) Await with a timeout on both hosts: Electron returns
  `requiresDeferredDisposal = true` while checks run and awaits the kill inside the bounded `withBudget` chain; VS Code
  starts the kill, runs the agent reap and flush, then awaits both (5 s cap); drop the redundant catch. (b)
  Fire-and-forget on both; document that the OS reaps. **Recommend (a)**: on Windows the `taskkill` dynamic import may
  never run on a sync quit, leaving Nx trees alive. (Batch 29)
- **G-B (G.7) — new name for `SubagentStopPort`.** (a) `SubagentBudgetDispatcherPort` (reviewer's name). (b)
  `SubagentBudgetActionsPort`. (c) `SubagentControlPort`. **Recommend (a)**: names the domain and the dispatcher it
  wraps. (Batch 30)
- **G-C (G.8 review-A m5) — `stopped` subagent status.** (a) Add `'stopped'` to the shared `SubagentStatus` union now
  (registry, history registrar, monitor, frontend status mapping). (b) Defer to a named later task; a budget-stopped
  subagent stays `completed` and the parent still gets the handoff. **Recommend (b)**: the union reaches persisted
  history and frontend badges; that is a feature, not a follow-up fix. (Batch 34)
- **G-D (G.6) — where the resume decision shows.** (a) RPC result + log only. (b) Also show "Started fresh: <reason>" in
  the UI (new frontend task and text). **Recommend (a)** now, (b) as a named later task. Batch 25 proceeds with (a);
  choosing (b) adds one frontend task after Batch 25.
- **G-E (G.8 FM-7) — capper still running after the 10 s timeout.** (a) Accept and document (a spool file nothing
  references, bounded by spool pruning). (b) Pass an `AbortSignal` into `ToolOutputCapper.cap`. **Recommend (a)**: no
  data loss, cheap. Task 18.4 waits on it; the Batch 18 executor skips it if unanswered and it moves to Batch 27.

### Batch table

| Batch | Items | Files | Executor | Model | Group / order |
| --- | --- | --- | --- | --- | --- |
| 16 | F.1 M5, M7 | 6 | backend-developer | Opus | P1 |
| 17 | F.6 backend Minors, F.1 M4, fixture Minor | 6 | backend-developer | Sonnet | P1 |
| 18 | G.1, capper `numLines`, FM-8, FM-7 (G-E) | 6 | backend-developer | Sonnet | P1 |
| 19 | F.3, keep-key pruning | 4 | frontend-developer | Opus | P2 |
| 20 | F.5 M2, M4, M5 | 2 | frontend-developer | Opus | P2 |
| 21 | G.3, stdio Minors | 4 | backend-developer | Opus | P2 |
| 22 | G.2, FM-6, m1, m3, FM-4/5/9, resume tap | 6 | backend-developer | Opus | P3 (after 16) |
| 23 | Task 8.3 gap: `execute_code` cancel | 6 | backend-developer | Opus | P3 (after 21) |
| 24 | G.5 pin tests | 1 | senior-tester | Sonnet | P3 |
| 25 | G.6 (a), setConfig, default-model check, barrels, `cancelled` | 6 | backend-developer | Opus | P4 (after 23) |
| 26 | `gitignoreFailure` log-once + dispatcher log | 5 | backend-developer | Sonnet | P4 (after 23) |
| 27 | stream-transformer helper, tap doc | 3 | backend-developer | Sonnet | P4 (after 22) |
| 28 | F.1 M1, M3 backend | 6 | backend-developer | Opus | PENDING DECISION F-A; after 16 |
| 29 | G.4 | 5 | backend-developer | Opus | PENDING DECISION G-A; after 21 |
| 30 | G.7 rename | 2 | backend-developer | Sonnet | PENDING DECISION G-B; after 22 |
| 31 | F.5 M1, B1 | 4 | backend-developer | Opus | PENDING DECISION F-F |
| 32 | F.5 M3 | 4 | frontend-developer | Opus | PENDING DECISION F-E; after 20 |
| 33 | F.1 M6, M3 UI, M8; F.4; F.6 UI Minors | 6 | frontend-developer | Opus | PENDING DECISION F-B, F-C, F-D; after 19, 28 |
| 34 | G.8 `stopped` status | 6 | backend-developer | Opus | PENDING DECISION G-C; after 22, 30, 31 |
| 35 | F.2 chat-view split | 4-5 | frontend-developer | Opus | F.2 group, LAST, alone; after 19, 33 and every chat-view batch |
| 36 | F.2 stats-chip split | 4 | frontend-developer | Opus | F.2 group, LAST; after 33; may run beside 35 |

Parallel groups are file-disjoint; at most 3 agents at once. Order P1 → P2 → P3 → P4 with the dependencies named.
Decision batches join the first group whose dependencies are committed, keeping the 3-agent cap and file disjointness.

Phases and reviews (decision 11): Phase F = Batches 16, 17, 19, 20, 28, 31, 32, 33; Phase G = Batches 18, 21-27, 29,
30, 34; Phase F.2 = Batches 35-36. One Opus code-logic review per phase on the combined diff after its last batch
commits. Sonnet style review for Phase G (new barrel exports in Batch 25, rename in Batch 30) and Phase F.2 (new
service). Phase F.2 also needs before/after screenshots (dark + light) of the chat view and the stats chip; they go to
the Stage C QA session.

Scoped checks for every batch (exit code 0 each; output tailed, R5): `npx nx run-many -t typecheck,lint,test -p <the
batch's projects>`, `npx nx run di-lint:lint`, `npx nx run degradation-audit:lint`. When the batch changes a
`libs/shared` type: `npx nx affected -t typecheck --exclude='api-*,ptah-license-server,ptah-landing-page-e2e'`. The
"Batch rules for every executor" above apply unchanged (R1 limit, subagents only, no git, no TASK_2026_609_c495 files,
real code, a regression test per item).

## Batch 16: Session budget entry lifetime and action guards (F.1 M5, M7) — COMPLETE (commit 0df5b0b14)

- Verified by team-leader (Mode 2, 2026-10-05). Deviation accepted: the eviction release also touched
  `session-lifecycle-manager.ts` (`onSessionEvicted` pass-through), `sdk-agent-adapter.ts` (subscription + dispose) and
  `sdk-agent-adapter.spec.ts`; Batch 22 (adapter) and Batch 27 (lifecycle manager docs) build on these. A3 holds: the
  spawner already imported `@ptah-extension/agent-sdk`; no new lib edge. R1 breach recorded: the executor used 94 tool
  calls (limit 60). Allowed failure: the pre-existing `session-query-executor.service.spec.ts:991` TS2554 (also on clean
  55f245619), now Task 22.6.

- Recommended executor: backend-developer | Fallback: backend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus (logic) | Tasks: 3 | Depends on: none | Group: P1 | Phase: F
- Projects: `@ptah-extension/agent-sdk`, `@ptah-extension/cli-agent-runtime`
- Files: `<R>\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget.service.ts` (+ `.spec.ts`),
  `<R>\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-registry.service.ts` (+ `.spec.ts`),
  `<R>\libs\backend\cli-agent-runtime\src\lib\session-children\session-spawner.service.ts` (+ `.spec.ts`)

### Task 16.1: `write-handoff` and `preview-handoff` need an entry (M5) — COMPLETE

- `act` (`session-budget.service.ts:237-267`) returns `{ success: false }` with a clear error when no entry exists for
  `write-handoff` / `preview-handoff` (`writeHandoffAction` 698-704, `previewHandoff` 711-729). Spec: unknown id → no
  file written, prune not run.

### Task 16.2: No entry resurrection after `release` (M7) — COMPLETE

- `recordCompaction` (204-209), the `accept` catch (287-305) and `acceptOrThrow` (311) must not create an entry for an
  id released in this process unless a new run registers it (for example `entries.get` instead of `entryFor` on these
  paths, or a released-id mark cleared on the next explicit start). Spec: release → late result → no entry.

### Task 16.3: Release on idle eviction and headless child end (M7) — COMPLETE

- `evictStale` (`session-registry.service.ts:583-599`) releases the budget entry of each evicted session through the
  existing release seam (`sdk-agent-adapter.ts:876-880` helper). Headless children (`session-spawner.service.ts:717-731,
  1296-1302`): release when the stop is a true end. Validation (A3): if the spawner cannot reach a release seam without a
  new cli-agent-runtime → agent-sdk import, stop and report; do not add the import.

### Batch 16 verification

- Specs above pass; scoped checks for agent-sdk and cli-agent-runtime.

## Batch 17: Session budget backend Minors and UUID check (F.6, F.1 M4) — COMPLETE (commit 2eb51a4c7)

- Verified by team-leader (Mode 2, 2026-10-05). Task 17.4: the SDK mints session ids with `crypto.randomUUID()` (v4),
  so `UUID_REGEX` is unchanged; `branded.types.ts` gets a comment only, so importers' types cannot change. Task 17.3: no
  importer of `SessionBudgetState` from `@ptah-extension/agent-sdk` (multiline grep over apps and libs).

- Recommended executor: backend-developer | Fallback: backend-developer (Opus) | Execution mode: Sequential subagent
- Model: Sonnet (mechanical) | Tasks: 5 | Depends on: none | Group: P1 | Phase: F
- Projects: `@ptah-extension/agent-sdk`, `@ptah-extension/shared` (comment and spec only unless A1 fails),
  `@ptah-extension/webview-e2e-harness`
- Files: `<R>\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget-stage.ts` (+ spec),
  `<R>\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-handoff-writer.ts` (+ spec),
  `<R>\libs\backend\agent-sdk\src\index.ts`, `<R>\libs\shared\src\lib\types\branded.types.ts` (+ spec),
  `<R>\libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings.fixtures.ts`

### Task 17.1: `keepPreviousFigure` uses the current limit — COMPLETE

- `session-budget-stage.ts:234-256`: when the previous figure is kept, use the current limit (a new extension counts).
  Spec.

### Task 17.2: Prune orphaned `.tmp` handoff files — COMPLETE

- `session-handoff-writer.ts:119-122` vs `isHandoffFileName` 76-81: prune also removes `.<uuid>.<uuid>.tmp` files older
  than a short age (never one being written now). Spec.

### Task 17.3: Drop the `SessionBudgetState` re-export — COMPLETE

- `agent-sdk/src/index.ts:83`: remove after a grep shows no importer uses that path.

### Task 17.4: Verify the SDK session id version (M4, A1) — COMPLETE

- Check the Claude Agent SDK source in `node_modules` for how session ids are made. v4 confirmed → comment at
  `branded.types.ts:39-40` naming the source, plus a spec with an SDK-shaped id. Not v4 → relax `UUID_REGEX` to any
  RFC 4122 version, run `nx affected -t typecheck` (exclusions above), and say so in the report.

### Task 17.5: Fixture own-key check — COMPLETE

- `settings.fixtures.ts:248`: `Object.hasOwn(SESSION_BUDGET_SETTINGS_FIXTURE, key)` (same file uses it at 407).

### Batch 17 verification

- Scoped checks for agent-sdk, shared, webview-e2e-harness; `nx affected` only if Task 17.4 relaxed the regex.

## Batch 18: Config warn-once, capper line count, PostToolUse guards (G.1, G.8) — COMPLETE (commit b02b99766)

- Verified by team-leader (Mode 2, 2026-10-05). Tasks 18.1-18.3 committed; Task 18.4 (G-E doc note) was not written
  and moves to Task 22.7.

- Recommended executor: backend-developer | Fallback: backend-developer (Opus) | Execution mode: Sequential subagent
- Model: Sonnet (mechanical) | Tasks: 4 | Depends on: none | Group: P1 | Phase: G
- Projects: `@ptah-extension/agent-sdk`
- Files: `<R>\libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.ts` (+ spec),
  `<R>\libs\backend\agent-sdk\src\lib\helpers\compaction\tool-output-capper.ts` (+ spec),
  `<R>\libs\backend\agent-sdk\src\lib\helpers\post-tool-use-hook-handler.ts` (+ spec)

### Task 18.1: Threshold and env-window warns fire once (G.1 / FM-1) — COMPLETE

- Route the warns at `compaction-config-provider.ts:113-130` and `:196-220` through the `warnedBudgets`-style set (key
  + value). Compute `budgetDefault` (40-48) once at construction. Spec: two `getConfig()` calls → one warn each.

### Task 18.2: `numLines` excludes the trailer — COMPLETE

- `tool-output-capper.ts:313`: count outline lines only. Spec.

### Task 18.3: Missing `options` fails open (FM-8) — COMPLETE

- `post-tool-use-hook-handler.ts:88, 123`: `options?.signal`; a missing signal is never aborted. Spec: hook without
  options returns the fail-open result.

### Task 18.4: Late capper work after the timeout (FM-7) — MOVED to Task 22.7 (doc note not written in Batch 18)

- (a) document the accepted behaviour at `post-tool-use-hook-handler.ts:136-148`; (b) pass the signal into
  `ToolOutputCapper.cap`. User decided: accept and document; do not pass the signal into the capper.

### Batch 18 verification

- Scoped checks for agent-sdk.

## Batch 19: Settings card sibling draft and write timeout; keep-key pruning (F.3, G.8) — COMPLETE (6083556d4)

- Recommended executor: frontend-developer | Fallback: frontend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus (race) | Tasks: 3 | Depends on: none | Group: P2 | Phase: F
- Projects: `@ptah-extension/chat`
- Files: `<R>\libs\frontend\chat\src\lib\settings\ptah-ai\session-budget-settings.component.ts` (+ spec),
  `<R>\libs\frontend\chat\src\lib\services\session-rotation-keep.service.ts` (+ spec)

### Task 19.1: Only a blurred sibling draft is committed (F.3, A4) — PENDING

- `commit` (424-444) auto-commits the sibling at 438-442 only when that field is not focused; otherwise it re-validates
  and leaves the draft. Spec: sibling focused mid-write → not saved.

### Task 19.2: `settings:set` has a timeout (F.3) — PENDING

- `write` (499-528, call 508-512) passes a write timeout like `SETTINGS_READ_TIMEOUT_MS` (365); timeout → field error,
  `busy` cleared. Spec.

### Task 19.3: Prune kept keys for closed sessions (G.8, review B FM7) — PENDING

- `session-rotation-keep.service.ts:32-38`: forget keys of sessions no open tab holds (source: the tab manager the
  banner already uses). Spec.

### Batch 19 verification

- Scoped checks for chat.

## Batch 20: Agent monitor store eviction and rekey (F.5 M2, M4, M5) — COMPLETE (e3b8e6e08)

- Recommended executor: frontend-developer | Fallback: frontend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 3 | Depends on: none | Group: P2 | Phase: F
- Projects: `@ptah-extension/chat-streaming`
- Files: `<R>\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts` (+ spec)

### Task 20.1: Evict request usage with no record (M2) — PENDING

- `onSubagentMessageComplete` (1963-1993): cap `_subagentRequestUsage` and drop its entries on session clear. Spec.

### Task 20.2: Rekey pending identities with the placeholder rewrite (M4) — PENDING

- `resolveParentSessionId` (1677-1709) also rewrites `parentSessionId` in `_pendingBackgroundIdentity` (630-633). Spec.

### Task 20.3: Evict pending identities on clear and by size (M5) — PENDING

- `clearSessionAgents` (1624-1631) drops them as `forceClearSessionAgents` (1636-1661) does; add a size cap. Spec.

### Batch 20 verification

- Scoped checks for chat-streaming.

## Batch 21: `run_check` kill failure; stdio cancel Minors (G.3, G.8) — COMPLETE (Tasks 21.1, 21.3; Task 21.2 moved to Batch 24A)

- Recommended executor: backend-developer | Fallback: backend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 3 | Depends on: none | Group: P2 | Phase: G
- Projects: `@ptah-extension/vscode-lm-tools`
- Files: `<R>\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\run-check.tool.ts` (+ spec),
  `<R>\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\stdio-mcp-server.service.ts` (+ spec)

### Task 21.1: A failed kill is reported and remembered (G.3 / B-1) — COMPLETE

- Default `killTree` (424) passes `onError` to `killProcessTree`; record `killFailed`. Verdicts 321/325 say "kill failed
  (pid N may still be running)" on failure. Keep the pid in `liveChecks` until `close` so `killRunningChecks` retries it.
  Spec: rejecting kill → reply text, pid still listed.

### Task 21.2: Do not answer a cancelled stdio request — MOVED to Batch 24A (needs ptah-cli `server.ts` + `mcp-serve.ts`)

- `stdio-mcp-server.service.ts:226-237`: no response once the call's controller aborted. Spec.

### Task 21.3: A duplicate in-flight id does not orphan a controller — COMPLETE

- `:224`: on a duplicate id keep the first controller (reject or log the second). Spec.

### Batch 21 verification

- Scoped checks for vscode-lm-tools.

## Batch 22: Monitor rekey ordering, stop retry gate, executor rekey gaps (G.2, G.8) — PENDING

- Recommended executor: backend-developer | Fallback: backend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 7 | Depends on: Batch 16 | Group: P3 | Phase: G
- Projects: `@ptah-extension/agent-sdk`
- Files: `<R>\libs\backend\agent-sdk\src\lib\helpers\compaction\subagent-budget-monitor.ts` (+ spec),
  `<R>\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.ts` (+ spec),
  `<R>\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` (+ spec),
  `<R>\libs\backend\agent-sdk\src\lib\helpers\post-tool-use-hook-handler.ts` (Task 22.7, comment only)
- Note (team-leader, 2026-10-05): 7 files, one over the 6-file cap; accepted because the seventh is a comment-only
  edit. Rebase onto Batch 16's adapter changes (`onSessionEvicted` subscription, `stopEvictionRelease`).

### Task 22.1: Alias the old id to the new id after `rekey` (G.2 / FM-2) — PENDING

- `rekey` (358-384) records `from → to`; `sessionState` (391-404) resolves an aliased id; `release` clears aliases of
  both ids. Spec: an old-id message after rekey adds to the same state; after release no state is created.

### Task 22.2: Retry a failed stop only on a new API message (FM-6) — PENDING

- Gate the retry at 326 on a new message id (or a minimum interval). Spec: three content blocks of one request → one
  attempt.

### Task 22.3: Failure count respects a stop in flight (rereview m1, m3) — PENDING

- `onStopFailed` (534-535, 577-603) counts only when `liveState.stopInFlight` is false. Add the four specs rereview m3
  lists (reject across a merge, both in flight, fired-target preference, merged task text).

### Task 22.4: Executor reads the current id; release covers the rekeyed id (FM-4, FM-5, FM-9) — PENDING

- `session-query-executor.service.ts:354-366` uses the tap's current `sessionId` in the `.then`; release (303-328)
  covers the id learned from PostCompact and checks the run token (FM-9). Specs.

### Task 22.5: The "already active" resume path passes the tap — PENDING

- `sdk-agent-adapter.ts:945-971`: pass `onMessage`/`onStreamEnd` as the other three call sites do. Spec.

### Task 22.6: Fix the pre-existing `session-query-executor.service.spec.ts` compile error — PENDING

- `session-query-executor.service.spec.ts:991`: TS2554, `new StreamTransformer(...)` passes 7 args, the constructor
  takes 8 (`planLimits`, `stream-transformer.ts:375`). Fails on clean main 55f245619 too; it was the only allowed
  agent-sdk test failure for Batches 16-18. Pass the missing argument as the other specs do; the suite must compile
  and pass, so the agent-sdk test target exits 0 again.

### Task 22.7: Document the late capper work after the timeout (FM-7, moved from Task 18.4) — PENDING

- User decision G-E, option (a) only: a comment at `post-tool-use-hook-handler.ts:136-148` (the race in
  `capToolOutput`) saying the capper keeps running after a timeout or abort, its late result is discarded, and this is
  accepted. Do not pass the signal into `ToolOutputCapper.cap`.

### Batch 22 verification

- Scoped checks for agent-sdk; the agent-sdk test target exits 0 (Task 22.6 removes the last allowed failure).

## Batch 23: `execute_code` cancel reaches `ptah.agent.waitFor` (G.8, Task 8.3 gap) — PENDING

- Recommended executor: backend-developer | Fallback: backend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 2 | Depends on: Batch 21 (same lib) | Group: P3 | Phase: G
- Projects: `@ptah-extension/vscode-lm-tools`
- Files: `<R>\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts`,
  `<R>\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\code-execution.engine.ts` (+ spec),
  `<R>\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts` (+ spec), one
  dispatcher spec

### Task 23.1: Request signal into `executeCode` — PENDING

- `protocol-dispatcher.ts:3703` passes `getRequestAbortSignal()` into the engine; the engine exposes it to namespaces.

### Task 23.2: `ptah.agent.waitFor` honours it — PENDING

- `agent-namespace.builder.ts:525-537` forwards the signal to `waitForAgents` (accepts one at 556-557). Spec: abort →
  the wait returns cancelled.

### Batch 23 verification

- Scoped checks for vscode-lm-tools.

## Batch 24: Pin `mcp-serve` id pass-through and drain dispose (G.5) — COMPLETE (837f93ff9)

- Recommended executor: senior-tester | Fallback: backend-developer (Sonnet) | Execution mode: Sequential subagent
- Model: Sonnet (test pins) | Tasks: 1 | Depends on: none | Group: P3 | Phase: G
- Projects: `ptah-cli`
- Files: `<R>\apps\ptah-cli\src\cli\commands\mcp-serve.spec.ts`

### Task 24.1: Two specs — PENDING

- `tools/call` with id 42 → `handleToolsCall` receives `id: 42` (`mcp-serve.ts:363-367`); stdin end → `dispose` is
  called before `transport.stop` (463-466). Each spec must fail against the old shape (`randomId()`, no dispose).

### Batch 24 verification

- Scoped checks for ptah-cli.

## Batch 24A: Do not answer a cancelled stdio request (G.8, moved from Task 21.2) — PENDING

- Recommended executor: backend-developer | Execution mode: Sequential subagent | Depends on: 21, 24 | Phase: G
- Projects: `ptah-cli`, `@ptah-extension/vscode-lm-tools`
- Files: `<R>\apps\ptah-cli\src\cli\jsonrpc\server.ts` (+ spec), `<R>\apps\ptah-cli\src\cli\commands\mcp-serve.ts`
  (+ spec; Batch 24 owns the spec first), `<R>\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\stdio-mcp-server.service.ts` (+ spec)

### Task 24A.1: A handler can say "send no response" — PENDING

- `server.ts:205-206` always encodes the handler result. Add a `NO_RESPONSE` sentinel that `dispatchRequest` checks before
  `send`; `mcp-serve.ts:369-381` `tools/call` returns it when the call was cancelled; the service reports the cancel
  (null or `isCancelled(id)`). Update the existing "aborts the agent_wait whose id the peer cancels" spec (it currently
  expects a `WAIT CANCELLED` result). Impact today is cosmetic (review B, FM6). Scoped checks for both projects.

## Batch 25: Resume decision in the RPC reply; setConfig, default model, barrels (G.6, G.8) — PENDING

- Recommended executor: backend-developer | Fallback: backend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 4 | Depends on: Batch 23 | Group: P4 | Phase: G
- Projects: `@ptah-extension/rpc-handlers`, `@ptah-extension/shared`, `@ptah-extension/cli-agent-runtime`; shared type
  change → `nx affected -t typecheck` (exclusions above)
- Files: `<R>\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts` (+ new `agent-rpc.handlers.spec.ts`),
  `<R>\libs\shared\src\lib\types\rpc.types.ts`,
  `<R>\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts` (+ spec),
  `<R>\libs\backend\cli-agent-runtime\src\lib\cli-agents\index.ts`

### Task 25.1: `resumeDecision` in the result and the log (G.6, G-D option a) — PENDING

- `rpc.types.ts:1343` result gains optional `resumeDecision?: AgentResumeOutcome`; both handler paths (1068-1074,
  1189-1191) return and log it. Spec.

### Task 25.2: Serialise `agent:setConfig` writes — PENDING

- `agent-rpc.handlers.ts:432-597`: one in-handler promise chain so two calls cannot interleave into stop ≤ steer. Spec.

### Task 25.3: Blocked-model check on the default model — PENDING

- `agent-process-manager.service.ts:531-548`: resolve the lane's default model before `findBlockedLaneModel`, as the
  `spawn` path does (603). Spec.

### Task 25.4: Barrel exports and a required `cancelled` (style Minors) — PENDING

- Export `GatedResume` (175) and `PreparedSdkHandleSpawn` (188) from `cli-agents/index.ts`; make
  `AgentWaitResult.cancelled` (241) required and update its construction sites.

### Batch 25 verification

- Scoped checks for rpc-handlers, cli-agent-runtime, shared, plus `nx affected -t typecheck`.

## Batch 26: Spool `.gitignore` failure logged once and by the dispatcher (G.8) — PENDING

- Recommended executor: backend-developer | Fallback: backend-developer (Opus) | Execution mode: Sequential subagent
- Model: Sonnet (log text) | Tasks: 2 | Depends on: Batch 23 | Group: P4 | Phase: G
- Projects: `@ptah-extension/tool-output-reducers`, `@ptah-extension/vscode-lm-tools`
- Files: `<R>\libs\backend\tool-output-reducers\src\lib\output-budget\apply-output-budget.ts` (+ spec),
  `<R>\libs\backend\tool-output-reducers\src\lib\output-budget\spool.ts` (+ spec), the vscode-lm-tools call site of the
  output budget (the executor locates it; not the `protocol-dispatcher.ts` lines Batch 23 changes)

### Task 26.1: Log once per spool directory — PENDING

- `ensureSpoolGitignore` (`spool.ts:184`) caches its outcome per directory; `apply-output-budget.ts:189-195` logs once.

### Task 26.2: The dispatcher logs `gitignoreFailure` — PENDING

- The vscode-lm-tools consumer WARNs a returned `gitignoreFailure` once. Spec.

### Batch 26 verification

- Scoped checks for tool-output-reducers and vscode-lm-tools.

## Batch 27: Stream-transformer callback helper and tap doc (G.8 style) — PENDING

- Recommended executor: backend-developer | Fallback: backend-developer (Opus) | Execution mode: Sequential subagent
- Model: Sonnet (mechanical) | Tasks: 2 | Depends on: Batch 22 | Group: P4 | Phase: G
- Projects: `@ptah-extension/agent-sdk`
- Files: `<R>\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts` (+ spec),
  `<R>\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`

### Task 27.1: One guarded-callback helper — PENDING

- Replace the twin try/catch at `stream-transformer.ts:465-481` and `:1002-1018` with one private helper; behaviour and
  log shape unchanged; existing specs pass.

### Task 27.2: Own doc for `onStreamEnd` — PENDING

- `session-lifecycle-manager.ts:310-318`: one doc per property. Bundling into one `compactionTap` object is recorded,
  not done (reviewer: tolerable). Takes Task 18.4 if Batch 18 skipped it.

### Batch 27 verification

- Scoped checks for agent-sdk.

## Batch 28: Restore shape and handoff read status (F.1 M1, M3 backend) — PENDING (decision recorded in context.md: F-A)

- Recommended executor: backend-developer | Fallback: backend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 2 | Depends on: Batch 16, Decision F-A | Phase: F
- Projects: `@ptah-extension/shared`, `@ptah-extension/agent-sdk`; shared type change → `nx affected -t typecheck`
- Files: `<R>\libs\shared\src\lib\types\session-budget.types.ts` (+ spec),
  `<R>\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-control.service.ts` (+ spec),
  `<R>\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget.service.ts` (+ spec)

### Task 28.1: Restore failure shape per F-A — PENDING (decision recorded in context.md)

- `session-control.service.ts:815-835`, doc 48-51 and `restoreWindow` 676-696 change together. Spec.

### Task 28.2: `SessionBudgetHandoff` read status (M3) — PENDING (decision recorded in context.md: batch-level)

- Add an optional read-status field (55-66); `buildHandoff` (587-624) sets it on an unknown workspace or a `readError`.
  Spec. The task needs no decision itself; it waits so the shared type changes land in one commit.

## Batch 29: One shutdown contract for `killRunningChecks` (G.4) — PENDING (decision recorded in context.md: G-A)

- Recommended executor: backend-developer | Fallback: backend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 2 | Depends on: Batch 21, Decision G-A | Phase: G
- Projects: `ptah-extension-vscode`, `ptah-electron`, `@ptah-extension/vscode-lm-tools`
- Files: `<R>\apps\ptah-extension-vscode\src\main.ts`, `<R>\apps\ptah-electron\src\activation\shutdown.ts` (+ new or
  nearest spec), `<R>\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\run-check.tool.ts` (JSDoc 387-395)

### Task 29.1: Apply G-A on both hosts — PENDING (decision recorded in context.md)

- Option (a): Electron `requiresDeferredDisposal` (379-381) is true while `runningCheckPids().length > 0` and the kill
  is awaited in the `withBudget` chain (498-511); VS Code (160-176) runs kill and reap concurrently, awaits both, and
  drops the redundant catch.

### Task 29.2: Doc and specs for the chosen contract — PENDING (decision recorded in context.md)

## Batch 30: Rename `SubagentStopPort` (G.7) — PENDING (decision recorded in context.md: G-B)

- Recommended executor: backend-developer | Fallback: backend-developer (Opus) | Execution mode: Sequential subagent
- Model: Sonnet (rename) | Tasks: 1 | Depends on: Batch 22, Decision G-B | Phase: G
- Projects: `@ptah-extension/agent-sdk`
- Files: `<R>\libs\backend\agent-sdk\src\lib\helpers\compaction\subagent-budget-monitor.ts` (+ spec, refs :19, :112)

### Task 30.1: Rename at 240-244 and 258 (run `ptah_lsp_references` first) — PENDING (decision recorded in context.md)

## Batch 31: Interrupt stamps activity; agentId binding without toolUseId (F.5 M1, B1) — PENDING (decision recorded in context.md: F-F)

- Recommended executor: backend-developer | Fallback: backend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 2 | Depends on: Decision F-F | Phase: F
- Projects: `@ptah-extension/vscode-core`, `@ptah-extension/agent-sdk`
- Files: `<R>\libs\backend\vscode-core\src\services\subagent-registry.service.ts` (+ spec),
  `<R>\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts` (+ spec)

### Task 31.1: `markAllInterrupted` stamps `lastActivityAt` (M1) — PENDING (decision recorded in context.md: batch-level)

- `subagent-registry.service.ts:654-668`, as `update` does (309). Spec. No decision of its own.

### Task 31.2: Bind per F-F — PENDING (decision recorded in context.md)

- `subagent-hook-handler.ts:259, 278-292`. Spec: no toolUseId and a match → bound; no match or ambiguous → WARN, unbound.

## Batch 32: Cost estimate per request model (F.5 M3) — PENDING (decision recorded in context.md: F-E)

- Recommended executor: frontend-developer | Fallback: frontend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 2 | Depends on: Batch 20, Decision F-E | Phase: F
- Projects: `@ptah-extension/shared`, `@ptah-extension/chat-streaming`; shared change → `nx affected -t typecheck`
- Files: `<R>\libs\shared\src\lib\utils\pricing.utils.ts` (+ spec),
  `<R>\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts` (+ spec)

### Task 32.1: Missing cache price per F-E (`pricing.utils.ts:400-416`) — PENDING (decision recorded in context.md)

### Task 32.2: Price each request with its own model (`sumRequestUsage` 196-225, cost 287-295) — PENDING (decision recorded in context.md)

## Batch 33: Budget UI follow-ups (F.1 M6, M3 UI, M8; F.4 residual; F.6 UI Minors) — PENDING (decision recorded in context.md: F-B, F-C, F-D)

- Recommended executor: frontend-developer | Fallback: frontend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 6 | Depends on: Batches 19, 28; Decisions F-B, F-C, F-D | Phase: F
- Projects: `@ptah-extension/chat`, `@ptah-extension/chat-ui`
- Files: `<R>\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts` (+ spec),
  `<R>\libs\frontend\chat\src\lib\components\molecules\notifications\session-budget-banner.component.ts` (+ spec),
  `<R>\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts` (+ spec)

### Task 33.1: `resolvedSessionBudget` ordering and clearing (M6) — PENDING (decision recorded in context.md: batch-level)

- `chat-view.component.ts:937-942`: with null revisions the snapshot wins; clear `_budgetActionState` on a tab or
  session change. Spec.

### Task 33.2: Banner warns on a failed transcript read (M3 UI, F-B) — PENDING (decision recorded in context.md)

### Task 33.3: `/compact` copy (M8; F-B, F-C; banner 298-309, 331-334) — PENDING (decision recorded in context.md)

### Task 33.4: Clear the limit banner when the budget is disabled (F.4, F-D) — PENDING (decision recorded in context.md)

### Task 33.5: A failed preview shows an error, not "Loading…" (chat-view 1278-1284, banner 162; F-B) — PENDING (decision recorded in context.md)

### Task 33.6: Tooltip from the configured percents (`session-stats-summary.component.ts:974-992`; A2; F-B) — PENDING (decision recorded in context.md)

## Batch 34: `stopped` subagent status (G.8 review-A m5) — DROPPED (user decision G-C: deferred as a named later task)

- Runs only if G-C = (a); with (b) it is recorded as a named later task and dropped.
- Recommended executor: backend-developer | Fallback: backend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 1 | Depends on: Batches 22, 30, 31; Decision G-C | Phase: G
- Projects: `@ptah-extension/shared`, `@ptah-extension/vscode-core`, `@ptah-extension/agent-sdk` plus frontend status
  mappings; `nx affected -t typecheck`
- Files: `<R>\libs\shared\src\lib\types\subagent-registry.types.ts` (18-23),
  `<R>\libs\backend\vscode-core\src\services\subagent-registry.service.ts`,
  `<R>\libs\backend\vscode-core\src\services\subagent-registry\subagent-history-registrar.ts`,
  `<R>\libs\backend\agent-sdk\src\lib\helpers\compaction\subagent-budget-monitor.ts` (541-544), their specs

### Task 34.1: Add `'stopped'` and map it end to end — DROPPED (deferred, named later task G-C)

# Phase F.2 — split chat-view and the stats chip (runs LAST, alone)

Hard dependency: Batches 35-36 start only after Batches 19 and 33 have committed (every batch that touches
`chat-view.component.ts` or `session-stats-summary.component.ts`) and after any other open batch in `libs/frontend/chat`
or `libs/frontend/chat-ui` has committed. No other batch runs while they run. Behaviour-preserving: the executor loads
the `humanize-library` skill; every existing spec passes unchanged except for moved tests.

## Batch 35: Move the budget flows out of chat-view (F.2 / PR3-S1, style M1 + M2) — PENDING

- Recommended executor: frontend-developer | Fallback: frontend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 2 | Depends on: Batches 19, 33 (and every chat-view batch) | Phase: F.2
- Projects: `@ptah-extension/chat`
- Files: `<R>\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts` (+ spec), new
  `<R>\libs\frontend\chat\src\lib\services\session-budget-actions.service.ts` (+ spec); the chat-view template only if
  a binding name changes

### Task 35.1: `SessionBudgetActionsService` — PENDING

- Move the budget state signals (925-958), `onBudgetAction` / `onBudgetPreview` / `runBudgetAction` (1271-1284,
  1344-1376), "Continue in new session" (`onBudgetContinue` 1286-1315) and "Rotate session" (`onBudgetRotate`
  1317-1342) into it; chat-view keeps thin delegates. (Line numbers will have moved after Batch 33; re-locate first.)

### Task 35.2: Move their specs — PENDING

## Batch 36: Split the stats chip budget formatting (F.2) — PENDING

- Recommended executor: frontend-developer | Fallback: frontend-developer (fresh run) | Execution mode: Sequential subagent
- Model: Opus | Tasks: 1 | Depends on: Batch 33 | May run beside Batch 35 (file-disjoint) | Phase: F.2
- Projects: `@ptah-extension/chat-ui`
- Files: `<R>\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts` (+ spec), new pure
  helper `session-budget-format.ts` (+ spec) beside it

### Task 36.1: Extract `tokensBudgetSuffix`, `costBudgetText`, `costBudgetSuffix`, `costTooltip`, `budgetTooltip` — PENDING

## Stage F + G next action

Orchestrator: run parallel group P1 now. That is Batch 16 (backend-developer, Opus), Batch 17 (backend-developer,
Sonnet) and Batch 18 (backend-developer, Sonnet). Run each as a sequential subagent with the batch executor prompt and
the R1 limit. Put decisions F-A to F-F and G-A to G-E to the user; Batches 28-34 and Task 18.4 stay PENDING DECISION
until they are answered. G.8's Batch 13 screenshots go to Stage C.

## Notes for phase review (team-leader)

- Batch 19 adds a new UI string for a settings write timeout ("Could not confirm saving <label>. Reopen settings to see the saved value.") not covered by decision F-B; phase review must judge it.
- Batch 19 touched out-of-list test stub session-budget-banner.component.spec.ts (test-only, accepted).
- Batch 24 verified by direct jest + eslint (19 passed); nx ptah-cli check blocked by Batch 22 in-flight agent-sdk edits; rerun full ptah-cli check at phase end.
