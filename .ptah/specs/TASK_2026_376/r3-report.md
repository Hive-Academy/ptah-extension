# Batch R3 report — finding 4: re-cutting the compaction-hook guard onto the right axis

## Q1 — Does ANY one-shot caller legitimately need the compaction hook fan-out?

No. Traced every caller of `SdkQueryRunner.runOneShot` (via `InternalQueryService.execute`)
listed in `b6-report.md` Q2 — memory curator, both skill-synthesis lane shapes, the
replay gate, the skill-enhancer, both agent-generation wizards, enhanced-prompts,
content-generation, agent-customization, and all four harness-ai services. None of
them can benefit, for a structural reason that has nothing to do with `maxTurns`:

- `SdkQueryRunner.buildOneShotHooks` (`sdk-query-runner.service.ts:513`, unchanged
  by this batch) mints `oneShotSessionId = \`internal-query-${Date.now()}\`` for
  EVERY one-shot query, unconditionally. This is deliberate and documented
  (TASK_2026_295) — a one-shot query has no Ptah session id at all.
- The only production subscriber to `CompactionCallbackRegistry` is
  `MemoryCuratorService.start()` (`memory-curator.service.ts:156-185`), and its
  handler calls `this.transcriptReader.read(data.sessionId, cwd)`
  (`memory-curator.service.ts:165`). `transcriptReader` resolves a real Ptah
  session's JSONL transcript. `internal-query-<epoch>` never was, and never can
  be, such a session — it names no session at all.
- So a `PreCompact` firing on ANY one-shot query, regardless of its `maxTurns`,
  produces exactly one outcome downstream: a failed transcript read
  (`'[memory-curator] transcript read failed'`) followed by a placeholder
  curation keyed to a phantom session id (`memory-curator.service.ts:174-180`).
  There is no `maxTurns` value at which this becomes useful work — B6's
  `maxTurns > 1` guard drew the line at the wrong place. It correctly identified
  `maxTurns: 1` as dead weight, but every `maxTurns > 1` caller it left wired
  (curator at 6, both wizards at 25/50, harness-ai at 6-10) has the exact same
  synthetic-id problem, which is what finding 4 raising `CURATOR_MAX_TURNS` to 6
  exposed in production.

Verdict: zero legitimate consumers exist on this path, at any turn budget.

## Q2 — Is the simplest correct change to stop wiring compaction hooks on the one-shot path entirely?

Yes. Implemented: `buildOneShotHooks` no longer takes a `maxTurns` parameter and
no longer calls `compactionHookHandler.createHooks` at all — the merged hooks
object contains only the subagent hooks. The now-unused
`SDK_COMPACTION_HOOK_HANDLER` constructor injection and its `CompactionHookHandler`
import were removed from `SdkQueryRunner` (it has no other use in this file; the
interactive path wires its own `CompactionHookHandler` instance inside
`SdkQueryOptionsBuilder`, which is untouched). The `input.maxTurns ?? DEFAULT_ONE_SHOT_MAX_TURNS`
call site was reverted to `this.buildOneShotHooks(input.cwd)`.

## Q3 — Does removing the hook change behaviour for a one-shot query that DOES cross the threshold? Is the hook load-bearing for compaction itself?

No, and no. Verified from `compaction-hook-handler.ts:134-350` and the installed
SDK types:

- `CompactionHookHandler.createHooks` builds pure notification callbacks. The
  `PreCompact` handler's only actions are: resolve/validate the session id and
  trigger, sample token usage, call `callbackRegistry.notifyAll(...)` and the
  optional `capturedCallback(...)`, and log. It has NO branch that gates,
  delays, or otherwise participates in the SDK's decision to compact — it
  unconditionally `return { continue: true }` at every exit, including the
  catch block (lines 172, 183, 199, 264, 344).
- `PostCompact` is symmetric: it only emits `sdkAdapterEvents.emitCompactionComplete`
  for UI notification purposes.
- The installed SDK's `sdk.d.ts` lists `PreCompact`/`PostCompact` as two entries
  in the general `HOOK_EVENTS` enum (line 780) alongside unrelated events
  (`SessionStart`, `Stop`, `SubagentStart`, ...) — the same generic
  hook-callback mechanism used everywhere else in the SDK, not a participation
  API. The field that actually controls whether the SDK compacts is
  `Options.autoCompactEnabled` / the threshold config (`sdk.d.ts:5371-5373`,
  `2764-2765`), which is entirely separate from `Options.hooks`.
- `b6-report.md` Q3 independently confirmed `compactionConfig` (read from
  `CompactionConfigProvider.getConfig()`) is logged but never written to
  `options.autoCompactEnabled` / `options.autoCompactThreshold` anywhere in
  `sdk-query-options-builder.ts` or this file — the SDK's OWN compaction
  defaults already govern one-shot queries independent of both the hook and
  this config read.

Conclusion: removing the compaction hooks changes nothing about whether or when
the SDK compacts a one-shot query. It only removes the (always-spurious, per Q1)
notification fan-out to `CompactionCallbackRegistry`. Compaction itself, if the
SDK's own threshold is crossed, proceeds exactly as before — Ptah simply is no
longer told about it on this path, which is correct because nothing downstream
could act on that notification anyway.

## Decision

Stop wiring compaction hooks on the one-shot path entirely, regardless of
`maxTurns`. Deleted the `maxTurns` parameter B6 added to `buildOneShotHooks`
(nothing reads it there anymore) and the now-dead `CompactionHookHandler`
injection. Kept the subagent hooks exactly as they were — `buildOneShotMcpServers`,
the permission mode, `DEFAULT_ONE_SHOT_MAX_TURNS`, and the synthetic
`internal-query-${Date.now()}` id are all untouched. `options.maxTurns` itself
(the SDK turn budget, separate from the hooks argument) is still set from
`input.maxTurns ?? DEFAULT_ONE_SHOT_MAX_TURNS` as before.

This makes the consumer-side guard mentioned in the task (rejecting
`internal-query-*` ids inside `MemoryCuratorService`) belt-and-suspenders rather
than the only fix — with this change the registry is never notified for a
one-shot query in the first place, so that guard now defends only the
INTERACTIVE path's real-but-unusual edge cases, not this one. I did not touch
`MemoryCuratorService` — that file is outside this batch's write boundary and is
being edited by another agent right now.

## Diff

`libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`:

- Module doc comment: `oneShot` mode line no longer claims compaction hooks are
  wired; the "Compaction hook conditionality" paragraph now states they are not
  wired on this path and why, and clarifies the interactive path's own
  `CompactionHookHandler` wiring (inside `SdkQueryOptionsBuilder`) is unaffected.
- Constructor: removed the `@inject(SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER)
private readonly compactionHookHandler: CompactionHookHandler` parameter and
  its import (`compaction-hook-handler.ts`) — the field became fully unused once
  `buildOneShotHooks` no longer calls it. `SDK_COMPACTION_CONFIG_PROVIDER` stays;
  it feeds the (pre-existing, out-of-scope) debug log at line ~390.
- `buildOneShotOptions`: reverted `this.buildOneShotHooks(input.cwd, input.maxTurns ?? DEFAULT_ONE_SHOT_MAX_TURNS)`
  back to `this.buildOneShotHooks(input.cwd)`.
- `buildOneShotHooks(cwd: string, maxTurns: number)` → `buildOneShotHooks(cwd: string)`.
  Dropped the `maxTurns > 1 ? compactionHookHandler.createHooks(...) : {}` branch
  entirely; `mergedHooks` is now built directly from `subagentHooks` only. Replaced
  B6's doc comment with one explaining the corrected axis (session-id reality, not
  turn count) and why the SDK's own compaction is unaffected (Q3 above).

`libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts`:

- Removed the `CompactionHookHandler` import, the `compactionHooks` mock/field
  from `RunnerHarness` and `makeRunner`, and the constructor argument.
- `runOneShot — does not wire memory-observation hooks`: dropped the assertion
  comparing the subagent parent id to a compaction session id (no compaction
  hooks are built anymore, so there is nothing to compare against); kept the
  assertion that the subagent hook still receives the synthetic id.
- Replaced the `runOneShot — compaction hooks gated on turn budget (TASK_2026_376 F6)`
  describe block (which asserted `maxTurns: 1` skips and `maxTurns: 6` / default
  build compaction hooks) with `runOneShot — compaction hooks never wired
(TASK_2026_376 finding 4)`: one parameterised test asserting `params.options.hooks`
  has neither `PreCompact` nor `PostCompact` for `maxTurns: 1`, `maxTurns: 6`
  (the curator's own budget), and no `maxTurns` given (default 25) — while the
  subagent hook still fires exactly once in every case.

## Verify

Project name from `libs/backend/agent-sdk/project.json`: `@ptah-extension/agent-sdk`.

```
$ npx nx run-many -t typecheck -p @ptah-extension/agent-sdk
NX   Running target typecheck for project @ptah-extension/agent-sdk:
NX   Successfully ran target typecheck for project @ptah-extension/agent-sdk
```

```
$ npx nx run-many -t test -p @ptah-extension/agent-sdk
NX   Running target test for project @ptah-extension/agent-sdk:
Test Suites: 1 failed, 1 skipped, 85 passed, 86 of 87 total
Tests:       2 failed, 2 skipped, 1432 passed, 1436 total
NX   Running target test for project @ptah-extension/agent-sdk failed
```

Header confirms `N = 1` project, as required.

The 2 failures are BOTH in
`src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts`
("returns an EXTRACTED status with no drafts... when model output is empty" and
"still resolves EXTRACTED (not stalled) after a tool-only pass"), asserting the
OLD `{ status: 'extracted', drafts: [] }` shape against code that now returns
`{ status: 'no-output', usedTools, toolNames }`. That file is
`libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts`
— outside this batch's write boundary, currently shown as locally modified
(`git status --porcelain` confirms `M` on that exact path) by the other CLI
agent fixing code-logic-review.md finding 2 (the `tools-only`/`silent`
false-`ran` bug) in real time. Not caused by this batch: this batch touched only
`sdk-query-runner.service.ts` and its own spec, neither of which that failing
spec file imports.

Isolated confirmation that this batch's own file is fully green:

```
$ npx nx run-many -t test -p @ptah-extension/agent-sdk --testFile=sdk-query-runner.service.spec.ts
Test Suites: 1 passed, 1 total
Tests:       27 passed, 27 total
NX   Successfully ran target test for project @ptah-extension/agent-sdk
```
