# Code Style Review — BACKEND phase, TASK_2026_626_7b3e

**Score: 7.5 / 10** — sound, consistent with sibling patterns; real but non-blocking gaps in size/responsibility and one duplicated contract shape.

## Verdict: APPROVED
0 Blocking, 0 Serious, 3 Moderate, 4 Minor. The Moderate items are worth fixing in a follow-up but do not break a boundary or type guarantee.

## Scope examined
`libs/shared` (`session-stats-live.ts`, `agent-adapter.types.ts`, `message-constants.ts`, `rpc-session.types.ts`, messages `index.ts`); `libs/backend/agent-sdk` (`live-session-stats-publisher.ts` in full, `session-stats-owner.service.ts` diff, `stream-transformer.ts` via `git diff -w`, `sdk-adapter-callback-registry.ts`, `sdk-agent-adapter.ts` diff); `libs/backend/cli-agent-runtime/.../wiring/sdk-callbacks.ts` diff. Compared against `NoActivityWatchdog`, `LiveUsageTracker`, the other `*CallbackRegistry` helpers and `parseSessionMcpStatusPayload`. Specs and the plan were not read in depth; no jest/nx run. I did not check other `IAgentAdapter` implementers or mocks for the new required method.

## Checks that passed (evidence)
- **Boundaries:** `shared` has no backend imports. `session-stats-live.ts:12` is `import type` only, and its comment (`:24-28`) records why deep validation is left to chat-state. The publisher's only `vscode-core` import is `import type { Logger }` (`live-session-stats-publisher.ts:36`). `stream-transformer.ts:29` already value-imports `Logger`/`TOKENS`, so this adds no new coupling.
- **Non-DI helper:** `LiveSessionStatsPublisher` is built per stream, with no `@injectable`. Sibling `no-activity-watchdog.ts` (`NoActivityWatchdog`) is also a non-DI per-stream class, while the `*Registry` and tracker classes are singletons. Per-stream state means DI would be wrong, so this is consistent.
- **Registry wiring:** `setLiveStats`, `getLiveStats` and the `clear()` entry (`sdk-adapter-callback-registry.ts`) mirror `resultStats` exactly. All five `startChatSession`/`resume`/`send` stream sites pass `onLiveStats` (`sdk-agent-adapter.ts`).
- **Activity and budget isolation:** the live callback bypasses `wrapResultStatsForActivity` (`sdk-agent-adapter.ts` doc at `setLiveStatsCallback`), as intended.
- **zod:** the backend boundary schema `AssistantFrameSchema` (`:101-122`) uses zod with a `.catch` annotated by a degradation-audit comment. The webview-side parser is hand-written for the stated bundle-size reason, matching `parseSessionMcpStatusPayload`.
- **Logging:** the injected `Logger` only. `warnOnce` logs the error name only, not the message (`:565-572`). The wiring logs at `debug` with the error name only.
- **Failure containment:** `observe`, `dispose`, `onOwnerReleased`, `emit` and `price` never throw. The `notifyWatchers` copy-then-iterate in the owner protects `release` and `recordAgent`.
- **External calls:** the broadcast is fire-and-forget with a stated reason for no retry, and the throttle timer is `unref`'d and released in `dispose`/`onResult`/`onOwnerReleased`.

## Five style questions
1. **What breaks in six months?** A second consumer of "estimate" semantics, or a change to the result path's pricing, will drift from `estimateRows`/`price` (Finding 2). The invariants on `provisional`/`context` live in comments only (Finding 5).
2. **What would a newcomer misread?** `publishLive(..., null)` also means "re-read the authoritative snapshot", so the method name suggests it always publishes something provisional. `authoritativeSnapshot()` calls `publishLive` and can return a still-provisional snapshot if another run holds an estimate (documented at `:439-443`, but the name misleads).
3. **Maintenance cost vs a simpler shape?** The 590-line publisher mixes three concerns, and the result-branch `finally` re-indents about 600 lines of `stream-transformer.ts` (Findings 1 and 3).
4. **Inconsistencies?** Two declarations of the context shape (Finding 4), plus the repeated "clear provisional" logic (Finding 6).
5. **What would I do differently?** Split usage accumulation and pricing out of the publisher, and extract the result branch into a method so the `try/finally` does not touch the diff. Both are refactors with a clear payoff, not mere preference.

## Findings

### 1. Moderate — `LiveSessionStatsPublisher` carries three responsibilities
`live-session-stats-publisher.ts:133-573`. It does (a) per-message usage accumulation and rate-card pricing (`recordUsage`, `estimateRows`, `price`, `:299-338`, `:470-516`), (b) throttle/timer scheduling (`requestFlush`/`arm`/`flush`, `:350-426`), and (c) the estimate-shown/settle state machine (`settling`, `released`, `estimateShown`, `emitAuthoritative`). Seven boolean/nullable flags interact. At 590 lines it exceeds the size of most sibling helpers, and the combination is hard to reason about for a newcomer.
**Fix:** extract the accumulate-and-price part into a small pure class or function (usage map in, `RunModelUsage[]` out), leaving the publisher with throttle and settle. This also makes Finding 2 testable in isolation. Do not extract anything else; the abstraction is justified by an existing seam, not a speculative one.

### 2. Moderate — Pricing and usage-row construction duplicates the result path
`live-session-stats-publisher.ts:495-511` (`resolveForCost` → `calculateMessageCost`) and `:484-491` (building `RunModelUsage` rows) re-implement what `stream-transformer.ts`'s result branch does for `modelUsage` (`usage.costUSD`/`runModels` construction). The two already differ: the live path has no catalog round-trip for unknown models, and the result path does (`stream-transformer.ts` "Prefer the already-hydrated map" comment). A pricing rule change would have to be made in two places.
**Fix:** share one `priceModelUsage(model, counters, env)` helper that both paths call, or record in the code why they must stay separate. The repo's own rule says similar code stays separate until a third use proves the shape, so this stays Moderate rather than Serious. The cost is the drift risk.

### 3. Moderate — `stream-transformer.ts` result branch wrapped in `try/finally`
`stream-transformer.ts` (1108 lines): the net change is about 61 lines (`git diff -w`), but wrapping the result branch in `try { ... } finally { livePublisher.settle(); }` re-indents roughly 600 lines. That inflates the diff and `git blame` noise, and the branch is now one very deep block with the settle correctness depending on every exit being inside it (comment lists them).
**Fix:** extract the result handling into a private method (`handleResult(...)`) called as `livePublisher.onResult(); try { await this.handleResult(...) } finally { livePublisher.settle(); }`. The file is already past a comfortable size, and `session-stats-owner.service.ts` is at 1102 lines (about +220 in this change), so avoid adding more to either file.

### 4. Minor — Context shape declared twice
`agent-adapter.types.ts` (`SessionStatsLivePayload.context` inline `{ model; contextTokens }`) vs `session-stats-live.ts:15-18` (`SessionStatsLiveContext`) vs publisher `MainContextReading` (`:71-74`). Three identical structural types with no shared definition, so they can drift. The wire/branded-id split for `sessionId` is justified (`session-stats-live.ts:9-10`); the context is not.
**Fix:** define `SessionStatsLiveContext` once (in `agent-adapter.types.ts`) and reference it from the other two.

### 5. Minor — `provisional`/`context` invariants are only prose
`rpc-session.types.ts` (`provisional?: boolean`) and `agent-adapter.types.ts` (`context` "ONLY when provisional === true"). The type permits `{provisional: undefined, context}`, which the parser silently handles by dropping `context` (`session-stats-live.ts:93-98`). A discriminated union would encode it, but would then mean a wider change to `SessionStatsEntry`, so a comment plus the parser guard is acceptable. No change required, but keep the parser test coverage.

### 6. Minor — Clear-provisional logic duplicated in `release`
`session-stats-owner.service.ts` `release()` loops runs to null `run.provisional` and calls `touch`, duplicating `clearProvisional` (per-run). Small, but the two will drift.
**Fix:** a private `clearAllProvisional(state): boolean` used by `release`, with `clearProvisional` reusing the per-run part.

### 7. Minor — Naming and small shape points
- `publishLive(..., null)` as an "authoritative re-read" and `authoritativeSnapshot()` returning possibly-provisional data (see Q2). Consider `settleSnapshot`/`currentSnapshot`, or document the null semantics on the method name.
- `this.timer = { handle }` (`:142`, `:376`) wraps an `unknown` handle in an object only to allow `null`; `unknown | null` collapses to `unknown`, so the wrapper is defensible but undocumented.
- `notifyWatchers` in the owner swallows with `void error` and a `degradation-audit: reported` comment claiming the watcher logs. This holds for `LiveSessionStatsPublisher` (its handlers have their own `try/catch` + `warnOnce`), but the owner cannot enforce that for other watchers. Keep the comment tied to the contract in `OwnerWatcher`'s docstring.

## Remaining uncertainty
Other `IAgentAdapter` implementers (CLI/Codex/Cursor adapters, test doubles) were not checked for the new required `setLiveStatsCallback`. `nx` typecheck of dependents should confirm.
