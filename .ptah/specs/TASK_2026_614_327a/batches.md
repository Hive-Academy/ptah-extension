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
