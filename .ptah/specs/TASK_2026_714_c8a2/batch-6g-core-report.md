# Batch 6g CORE2 report

## Status

- Decision 13 implemented: codex-runtime.types.ts:247 exposes the catalog key and execution model separately; codex-runtime.ts:671 maps both. codex-runtime.spec.ts:285 proves id != model and sends the selected model slug in thread/start and turn/start. The core forwards the selected profile/settings model; the agent-sdk lane must select Model.model.
- Decision 17 implemented: codex-runtime.ts:671 rejects every model/list failure with the safe error 'Codex model listing failed' without calling onFailure. Regression coverage in codex-runtime.spec.ts:346,364,381,392 starts another turn after invalid responses, repeated cursors, 100-page exhaustion and RPC rejection.
- Decision 19 implemented: codex-event-translator.ts:28,132 uses cumulative total differences for all six token counters. A known thread total is captured at turn/started; without one the first update establishes baseline = total - last. Each update is a whole-turn snapshot, not an incremental quantity. Terminal carries the latest snapshot. Baselines are removed at terminal and all maps at disposal. Repeated snapshots do not double count; late events remain suppressed.
- Specs at codex-event-translator.spec.ts:213 cover two requests, cached and cache-write tokens, a prior completed turn, resumed/first-seen total baseline, duplicate updates, and omission defaulting to zero. Existing first-turn/unknown-usage tests remain.
- Gateway mapping corrected in codex-gateway-adapter.ts:264: input excludes cached input; cacheRead and cacheCreation are separate. The existing projection spec now uses nonzero cache buckets.
- No protocol schema edit required: codex-protocol-schemas.ts:499 already accepts cacheWriteInputTokens as optional. The translator applies its pinned default of zero.

## Evidence ? decision 13

Pinned source (absolute prefix for all relative core files below):
D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/

- protocol/codex-app-server-protocol.schema.json:15075, v2.Model, requires both "id" and "model"; each property is exactly {"type":"string"}. Neither has a description. They cannot be inferred to be interchangeable from this schema.
- Same schema:23921, ThreadStartParams.model is {"type":["string","null"]}, with NO description in this pin.
- Same schema:25110, TurnStartParams.model description: "Override the model for this turn and subsequent turns."
- D:/projects/ptah-extension/node_modules/@openai/codex/package.json:3 pins "version": "0.155.1". bin/codex.js:112 resolves the binary; :241 calls "spawn(binaryPath, process.argv.slice(2), ...)".
  The installed package contains bin, package.json and README.md; no Rust source is vendored. The SDK typings do not expose an app-server Model catalog contract and cannot prove id equals model.
- Upstream reached successfully: https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/model.rs#L118 declares "pub id: String" and "pub model: String" separately.
- Upstream conversion: https://github.com/openai/codex/blob/main/codex-rs/app-server/src/models.rs#L16 defines model_from_preset(preset: ModelPreset), then at lines 18?19: "id: preset.id.to_string()," and "model: preset.model.to_string(),".
  This is the requested ModelPreset-to-v2.Model evidence; the conversion is now in app-server/src/models.rs rather than inside the v2 type module.
- The old monolithic v2.rs path and rust-v0.155.1 URL returned 404. Current upstream main was reachable; it is supporting semantic evidence, not asserted to be byte-identical to the pinned executable.

Conclusion: id is a catalog key; model is the execution model. The agent-sdk picker and thread/turn settings must use model. Core does not guess a conversion from an arbitrary string.

## Evidence ? decision 19

- Pinned protocol/codex-app-server-protocol.schema.json:24383 defines ThreadTokenUsage with required ["last","total"], both referencing "#/definitions/v2/TokenUsageBreakdown". There are NO descriptions on these counters or on last/total.
- Same schema:24675 defines inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens as int64 integers and cacheWriteInputTokens as {"default":0,"format":"int64","type":"integer"}. The schema alone does not establish whether last is per request or per turn, or whether input includes cache hits.
- D:/projects/ptah-extension/node_modules/@openai/codex-sdk/dist/index.d.ts:119?132 describes Usage as "Describes the usage of tokens during a turn." Input, cached input, cache writes, output and reasoning output docs each say "used during the turn" (cache writes say written during the turn).
- D:/projects/ptah-extension/node_modules/@openai/codex-sdk/dist/index.js:88?91 only defaults parsed.usage.cache_write_input_tokens to 0, then yields the CLI event. Lines 110?111 assign "usage = event.usage". The JavaScript SDK performs no whole-turn accumulation itself; these docs refer to CLI turn.completed, not app-server tokenUsage.last.
- Upstream https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs#L2393 declares TokenUsage with input, cached input, cache writes, output, reasoning output and total.
  Nearby TokenUsageRecord documentation describes "one completed response".
- Same upstream file, lines 2463?2465, append_last_usage executes "self.total_token_usage.add_assign(last);" then "self.last_token_usage = last.clone();".
- Same upstream file, lines 2582?2584, non_cached_input returns "(self.input_tokens - self.cached_input()).max(0)". This establishes cached input is included in raw input.
- Upstream CLI implementation: https://github.com/openai/codex/blob/main/codex-rs/exec/src/event_processor_with_jsonl_output.rs#L118 usage_from_last_total maps usage.total fields into CLI Usage. Lines 509?510 retain notification.token_usage; lines 533?534 emit TurnCompleted with usage_from_last_total(). Thus SDK turn-completed usage is not evidence that app-server last is whole-turn usage. Current upstream main differs from the pinned binary and is cited as supporting source evidence.

Conclusion: last is the latest model response/request, total is cumulative. Whole-turn accounting therefore uses total minus a stable turn baseline. Raw input INCLUDES cached input. Core preserves that raw convention and exports cacheWriteInputTokens; adapters that use disjoint input/cache buckets subtract cached input once. No cost is inferred.

## Contracts for the agent-sdk lane

```ts
export interface CodexModelInfo {
  /** Catalog key; use model for thread/start and turn/start. */
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  readonly description?: string;
  readonly isDefault: boolean;
  readonly supportedEfforts?: readonly string[];
}

export interface CodexReportedUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
}
```

Use model.model for picker values and thread/start or turn/start model settings; id remains only the catalog key.
Usage snapshots and terminal usage cover the whole turn; do not sum snapshots. Preserve missing usage when no update exists.
Map input = inputTokens - cachedInputTokens, cacheRead = cachedInputTokens, cacheCreation = cacheWriteInputTokens.
The core normalizes omitted wire cacheWriteInputTokens to zero. reasoningOutputTokens is included in outputTokens, so do not add it again.

## Absolute paths changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-runtime.types.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-runtime.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-event-translator.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6g-core-report.md

## Verification

Formatted all seven source/spec files with the worktree node_modules/.bin/prettier --write.

Scoped ptah_get_diagnostics initially reported:

> TypeScript check still running after 45s. It was not cancelled.

The subsequent cached result for all seven changed files:

> Source: typescript-compiler
> Errors: 0 | Warnings: 0 ? No issues found.
> Coverage: clean
> Shown 0 of 0 (0 in requested files, 0 in sibling files omitted)

One permitted scoped verification command was started:

> npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/gateway-chat-bridge

At the single allowed completion check, the command was still running (native exec session 48989); the tail filter had produced no output. Therefore no verification exit code or test pass is claimed. The run was not repeated or cancelled. This is the remaining verification limitation; the team leader owns authoritative verification.

Native tool output:

> session_id: 48989
> output: ""
> exit_code: not returned (still running at completion check)

No live or paid model tests, build, install or git commands were run.

## Decisions

- Follow binding decisions 13,17,19 and existing runtime/translator boundaries. Options: treat catalog id as model, or expose the execution model separately. Evidence above selects the separate required model field. Reversible source change; downstream lane notified.
- Use stable cumulative-total differences rather than last or summing snapshots. Evidence: append_last_usage and SDK/CLI distinction. Fallback baseline is first total minus last when no prior total exists, exactly as directed. Reversible, covered by regression specs.
- Preserve optional public usage counters for consumers that have no usage; normalize only schema-defined cache-write omission. No extra schema or abstraction was needed because the strict boundary already permits the field.
- Return the same safe model-list error for RPC rejection, invalid response and pagination guards. No context close for a catalog error; genuine process failures retain their existing process lifecycle handling.
- Gateway receives the same disjoint cache/input mapping as the agent-sdk lane. No out-of-ownership agent-sdk changes made.

## Fix after team-leader verify

Root cause: production process validation, not the fixture. In codex-app-server-process.ts, receive() called validateCodexFrame() with the pending method. An invalid model/list result threw CodexProtocolError(invalidResult), escaped to onData(), and triggered fail('Codex invalid protocol frame'). That closed the process and live context before listModels() could return its safe error.

Fix: codex-app-server-process.ts:308 catches only invalidResult for a correlated model/list request, clears its timer, removes its pending entry, and rejects that request with the payload-free protocol error. Envelope validation still runs first; malformed envelopes, unrelated result failures, framing errors, and process failures retain fail-closed behavior. Runtime listModels() continues to expose 'Codex model listing failed'. This uses the explicit permission to edit the responsible extra process file and its spec.

Regression coverage:

- codex-runtime.spec.ts:338 retains all four invalid-response cases and the original subsequent startTurn assertion. At :345 it additionally asserts the process remains open and a fresh catalog request succeeds.
- codex-app-server-process.spec.ts:360 checks request-local rejection, a concurrent request completing, timer cleanup, and catalog retry.
- codex-app-server-process.spec.ts:379 checks malformed catalog envelopes still close the process.
- Existing invalid non-catalog-result fail-closed specs remain unchanged.

Files written in this follow-up (absolute paths):

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-app-server-process.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6g-core-report.md

Verification:

- Prettier completed for all three edited TypeScript files.
- Scoped ptah_get_diagnostics was called before verification, then requested again after the last spec edit. Both returned unavailable, not clean:

> Source: typescript-compiler ? Unavailable
> Coverage: qualified ? 3 files unchecked
> TypeScript check still running after 45s. It was not cancelled.

- Exactly one permitted scoped test command was launched:

> npm run verify -- -t test -p @ptah-extension/codex-runtime

It is running under native exec session 35060. At the single completion check, the last-45-lines filter had not returned output:

> session_id: 35060
> output: ""
> exit_code: not returned (still running)

No test pass or diagnostics pass is claimed. The command was not cancelled or rerun. Team leader must collect the eventual verification result. No paid/live tests, installs, builds, or git commands were run.

Decision: isolate only validated-envelope catalog result errors, rather than suppressing protocol validation or weakening context reuse assertions.
