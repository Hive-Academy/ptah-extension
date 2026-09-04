# Batch B6 report — F6: compaction hooks on a query that cannot compact

## Q1 — What does `hasCallback: false` mean?

`hasCallback` reports whether the CALLER passed a per-query
`onCompactionStart` closure into `CompactionHookHandler.createHooks`
(`libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts:134-143`).
`SdkQueryRunner.buildOneShotHooks` never passes a third argument
(`sdk-query-runner.service.ts:517-520`, pre-change), so it is always `false`
for a one-shot query — this is "no per-call closure supplied", not "no
subscriber anywhere".

The hook has a SECOND, independent fan-out: `CompactionCallbackRegistry`
(`compaction-callback-registry.ts`), injected separately and checked at
`compaction-hook-handler.ts:218` (`this.callbackRegistry.size > 0`). That
registry has exactly one production subscriber: `MemoryCuratorService.start()`
(`libs/backend/memory-curator/src/lib/memory-curator.service.ts:156-185`),
which reads `data.sessionId` and calls
`this.transcriptReader.read(data.sessionId, cwd)` to curate the real
transcript before it gets summarised away. So `hasCallback: false` does NOT
mean "no subscriber" — it means the LOCAL closure is absent while the GLOBAL
registry may still be populated. This distinction is the reason the fix below
is not the pure log-noise finding F6 files it as.

## Q2 — `DEFAULT_ONE_SHOT_MAX_TURNS` and caller turn budgets

`DEFAULT_ONE_SHOT_MAX_TURNS = 25` (`sdk-query-runner.service.ts:66`), used
when a caller's `InternalQueryConfig.maxTurns` is `undefined`.

Callers that reach `SdkQueryRunner.runOneShot` (via
`InternalQueryService.execute`, `internal-query.service.ts:378-390`), and
what they pass:

| Caller                                         | File:line                                                            | maxTurns                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Memory curator                                 | `curator-llm-adapter/sdk-internal-query.curator-llm.ts:382,431`      | `CURATOR_MAX_TURNS = 6` (raised from 1 by B5, same task)                                 |
| skill-synthesis lane runner (tool-use lanes)   | `skill-synthesis/lanes/lane-runner.service.ts:389-390`               | `LANE_TOOL_USE_DEFAULT_MAX_TURNS` (multi-turn), forced to `1` only when `toolUse:'none'` |
| skill-synthesis replay gate                    | `skill-synthesis/gates/replay-validator.service.ts:430`              | `1` (deliberate — `toolUse:'none'` lane)                                                 |
| skill-synthesis skill-enhancer                 | `skill-synthesis/skill-enhancer.service.ts:758`                      | `1`                                                                                      |
| agent-generation `agentic-analysis` wizard     | `agent-generation/wizard/agentic-analysis.service.ts:48,188`         | `MAX_AGENT_TURNS = 25`                                                                   |
| agent-generation `multi-phase-analysis` wizard | `agent-generation/wizard/multi-phase-analysis.service.ts:77,468,501` | `MAX_AGENT_TURNS = 50`                                                                   |
| agent-generation enhanced-prompts              | `agent-generation/enhanced-prompts/enhanced-prompts.service.ts:787`  | `10`                                                                                     |
| agent-generation content-generation            | `agent-generation/content-generation.service.ts:382`                 | `25`                                                                                     |
| agent-generation agent-customization           | `agent-generation/agent-customization.service.ts:198`                | `1`                                                                                      |
| rpc-handlers harness-suggestion                | `rpc-handlers/harness/ai/harness-suggestion.service.ts:186,524`      | `6`, `10`                                                                                |
| rpc-handlers harness-subagent-design           | `rpc-handlers/harness/ai/harness-subagent-design.service.ts:154`     | `6`                                                                                      |
| rpc-handlers harness-skill-generation          | `rpc-handlers/harness/ai/harness-skill-generation.service.ts:134`    | `6`                                                                                      |
| rpc-handlers harness-document-generation       | `rpc-handlers/harness/ai/harness-document-generation.service.ts:143` | `6`                                                                                      |

Verdict: turn budgets on this path span `1` to `50`. Several callers
(memory curator at 6, both wizard services at 25/50, the harness-ai services
at 6-10) have enough turns for the SDK's own context accounting to plausibly
cross a 100k-token compaction threshold inside ONE query (tool-heavy passes
reading files/workspace content). Only the `maxTurns: 1` callers are
STRUCTURALLY incapable of it (see Q4). A blanket removal would have broken
those multi-turn callers — the task's constraint not to do that is correct.

## Q3 — What does wiring the hook cost?

`buildOneShotHooks` (pre-change) does two things per query, unconditionally:

1. `subagentHookHandler.createHooks(cwd, oneShotSessionId)` — always needed
   (TASK_2026_295), untouched by this batch.
2. `compactionHookHandler.createHooks(oneShotSessionId, cwd)` — allocates a
   closure pair (`PreCompact`/`PostCompact` matchers) and logs one `info` line
   (`'[CompactionHookHandler] Creating hooks for session'`,
   `compaction-hook-handler.ts:140-143`). No I/O, no registry write — the
   registry is only touched if/when the SDK actually fires `PreCompact` at
   runtime, which for `maxTurns:1` cannot happen (Q4).

Separately, `buildOneShotOptions` calls
`this.compactionConfigProvider.getConfig()` unconditionally
(`sdk-query-runner.service.ts:387`, unchanged by this batch — see "left
alone" below). `CompactionConfigProvider.getConfig()` reads
`vscode.workspace.getConfiguration('ptah').get(...)` twice
(`compaction-config-provider.ts:66-69`) plus one `debug` log. VS Code caches
its configuration store internally, so this is an in-memory read, not file
I/O — cheap, but genuinely uncached at OUR layer and re-read every call.

Also notable, found while tracing this: `compactionConfig` is computed and
logged but **never applied** to `SdkQueryOptions` — there is no
`options.autoCompactEnabled` / `options.autoCompactThreshold` write anywhere
in `sdk-query-options-builder.ts` or `sdk-query-runner.service.ts`. The SDK's
own compaction defaults govern one-shot queries regardless of this config
read. This is a separate, pre-existing gap outside F6's scope (F6 is about
the HOOK, not this config plumbing) — left unchanged; flagged here so it is
not lost.

Conclusion: the setup cost is real but small (one allocation, one log line,
one cheap config read) — this alone would justify "no change" under option
(a). It is Q4 that changes the decision.

## Q4 — Risk of keeping PreCompact wired on a one-shot query

**For `maxTurns: 1`: no risk, because it cannot fire at all.**
`Options.maxTurns` docs (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1527-1530`,
already verified by B5 in `sdk-internal-query.curator-llm.ts:141-162`): "A
turn consists of a user message and assistant response" — one API
round-trip. Compaction summarises conversation HISTORY **between** turns.
With `maxTurns: 1` there is no second turn, hence no prior history to
summarise before it, hence PreCompact is structurally unreachable. This is
the exact case the production log in F6 shows (`maxTurns:1`,
`hasCallback:false`) — dead weight, zero risk, confirming F6's own framing
for that specific shape.

**For `maxTurns > 1`, a real risk exists, and it is the TASK_2026_293 defect
class recurring in a new shape.** Per
`libs/backend/agent-sdk/CLAUDE.md` "Hook session identity": TASK_2026_293 was
"PreCompact skipped the resolve entirely and fanned the **unresolved** id to
the memory curator, whose transcript reader rejected it as path traversal."
That was fixed by `resolveHookSessionId` requiring resolve-or-reject. But the
one-shot path hands the hook a **resolved, non-empty, synthetic** id —
`internal-query-<epoch>` — which passes that resolver cleanly (it is not
`''`). If a multi-turn one-shot query (curator's own `CURATOR_MAX_TURNS: 6`
run, a wizard's 25/50-turn pass, a harness-ai 6/10-turn pass) legitimately
crosses the SDK's own compaction threshold, `PreCompact` fires with
`sessionId: 'internal-query-<epoch>'`, and
`CompactionHookHandler.createHooks` unconditionally checks
`this.callbackRegistry.size > 0` and calls `notifyAll(...)`
(`compaction-hook-handler.ts:218-226`) — independent of whether THIS caller
passed a local `onCompactionStart`. `MemoryCuratorService.start()`'s
subscriber then receives that synthetic id as `data.sessionId` and calls
`this.transcriptReader.read('internal-query-<epoch>', cwd)`
(`memory-curator.service.ts:165`), which cannot find a real transcript for a
session that never existed, logs `'[memory-curator] transcript read failed'`,
and falls through to `this.curate({ sessionId: data.sessionId })` — a
placeholder curation keyed to a phantom session id
(`memory-curator.service.ts:174-180`). That is spurious background work and a
junk row in the curator's own bookkeeping, triggered by an unrelated
subsystem's internal query (e.g. skill-synthesis's lane compacting would
spuriously wake the memory curator).

This risk is **not fixed by this batch** — fixing it requires
`CompactionHookHandler.createHooks` to stop fanning one-shot-synthetic ids to
the shared registry, and that file
(`libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts`) is
outside this batch's write boundary (also used by the interactive path via
`sdk-query-options-builder.ts:1377`, and two read-only reviewers are on this
repo right now). It is recorded here as a follow-on finding for a future task
rather than fixed, per the write-boundary constraint.

## Decision: (b) — targeted change, scoped to what this batch can safely fix

`buildOneShotHooks` now takes the caller's effective `maxTurns` and skips
building compaction hooks entirely when `maxTurns <= 1` — the one case that
is BOTH pure cost (Q3) AND structurally guaranteed to never fire (Q4), so
skipping it removes dead weight with zero behavior change for any real
caller. Every caller with `maxTurns > 1` (curator, skill-synthesis lanes,
both wizard services, all four harness-ai services) is untouched — they keep
the hooks exactly as before, per the task's explicit constraint not to widen
this into a blanket removal.

This does not close the Q4 risk for multi-turn one-shot callers (documented
above as a follow-on). It does eliminate the literal case the production log
showed, and it is the only lever available inside this batch's write
boundary (`sdk-query-runner.service.ts` cannot alter
`compaction-hook-handler.ts`'s registry fan-out).

The `internal-query-${Date.now()}` synthetic id and `buildOneShotMcpServers`
were not touched, per the task constraints.

## Diff

`libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`:

- `buildOneShotOptions` now calls
  `this.buildOneShotHooks(input.cwd, input.maxTurns ?? DEFAULT_ONE_SHOT_MAX_TURNS)`
  instead of `this.buildOneShotHooks(input.cwd)`.
- `buildOneShotHooks(cwd: string, maxTurns: number)` gained the `maxTurns`
  parameter and now builds `compactionHooks` only when `maxTurns > 1`;
  otherwise it merges only `subagentHooks`. Added a doc comment recording the
  Q1-Q4 reasoning and pointing at this report for the residual multi-turn
  risk.

`libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts`:

- New `describe('runOneShot — compaction hooks gated on turn budget (TASK_2026_376 F6)')`
  with three specs: `maxTurns: 1` skips `compactionHooks.createHooks` while
  `subagentHooks.createHooks` still fires; `maxTurns: 6` still builds
  compaction hooks; the no-`maxTurns`-given default (25) still builds
  compaction hooks.

## Verify

```
$ npx nx run-many -t test -p @ptah-extension/agent-sdk
NX   Running target test for project @ptah-extension/agent-sdk:
Test Suites: 1 skipped, 86 passed, 86 of 87 total
Tests:       2 skipped, 1434 passed, 1436 total
NX   Successfully ran target test for project @ptah-extension/agent-sdk

$ npx nx run-many -t typecheck -p @ptah-extension/agent-sdk
NX   Running target typecheck for project @ptah-extension/agent-sdk:
NX   Successfully ran target typecheck for project @ptah-extension/agent-sdk
```

Header confirms `N = 1` project in both runs, as required.
