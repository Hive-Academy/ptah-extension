# Batch 1: Native counter input

## Summary

The translator emits typed native cumulative usage evidence, retains the existing turn usage shape, and carries structured diagnostics for ambiguous or stale data. Explicit reset proof starts a new per-thread epoch. Late usage after completed, failed or interrupted turns is emitted with that turn's terminal state. Repeated totals do not add tokens.

## Files changed

- `libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts`: structurally validates native usage and accepts ambiguous class and last/total relationships.
- `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts`: defines counters, evidence, epoch and typed diagnostics.
- `libs/backend/codex-runtime/src/lib/codex-event-translator.ts`: emits evidence and diagnostics, handles explicit reset, and retains late usage.
- `libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts`: adds focused edge cases.
- `libs/backend/codex-runtime/src/index.ts`: re-exports usage types.
- `.ptah/specs/TASK_2026_codex_usage_pricing/task-batch1-report.md`: this report.

## Native field names verified

The pinned App Server schema at `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json:25623-25642` requires `threadId`, `turnId` and `tokenUsage` on `ThreadTokenUsageUpdatedNotification`. `TokenUsageBreakdown` at `:25936-25970` requires `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningOutputTokens` and `totalTokens`; `cacheWriteInputTokens` is optional. `codex-protocol-methods.ts:343-351` names `tokenUsage.last`, `tokenUsage.total` and optional `modelContextWindow`. The pinned notification declares neither parent thread, model, nor counter reset. Those optional fields in the translator require a compatible future native version. Reasoning output remains a subset of output.

## Callers outside scope

- `libs/backend/codex-runtime/src/lib/codex-context.ts:126,404-410`: constructs the translator and filters child and post-terminal events.
- `libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:29,343-351`: imports the shared `usage` schema.
- `libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts:23,176-183,242-274`: validates notification schemas.
- `libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts:514,533`: constructs the translator.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts:10,99,145,272-283`: consumes runtime events and usage.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:42,144,479`: consumes runtime types.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-native-contract.spec.ts:70,231,235,282`: constructs the translator and consumes events.

The optional event fields and optional third constructor argument preserve existing caller signatures.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Extend existing usage and terminal events with optional evidence | Add event variant; extend existing variants | Agent SDK switches on the existing event union | Yes |
| Require explicit `counterReset: true` before rebasing a decreasing total | Rebase automatically; retain old checkpoint | Plan section 2 requires reset proof; pinned protocol lacks a marker | Yes |
| Retain raw cache counters and flag ambiguous semantics | Reject inconsistent class breakdown; accept and flag | Pinned schema does not define cache-write inclusion | Yes |
| Keep native IDs as strings | Add new branded IDs | This library has no native branded ID helpers | Yes |
| Keep terminal evidence as the last accepted snapshot | Carry last observed stale snapshot | Stale totals must not replace an accepted checkpoint | Yes |

## Revision 1

| Defect | Fix | File:line | Spec |
| --- | --- | --- | --- |
| D1: cache-write-heavy totals dropped | Removed cross-class refine; retained raw classes, clamped uncached projection, flagged ambiguity | `codex-protocol-schemas.ts:637`, `codex-event-translator.ts:35,285` | `codex-event-translator.spec.ts:421` |
| D2: `last > total` dropped | Removed cross-snapshot refine; flagged evidence and used a safe initial baseline | `codex-protocol-schemas.ts:647`, `codex-event-translator.ts:284,333` | `codex-event-translator.spec.ts:435` |
| D3: reset left thread stuck | Explicit marker starts an epoch and rebases the turn, preserving prior turn usage | `codex-event-translator.ts:277,325` | `codex-event-translator.spec.ts:458` |
| D4: stale/rejected updates lacked reason | Added content-free evidence diagnostics and typed invalid-payload event diagnostic | `codex-runtime.types.ts:203,320`, `codex-event-translator.ts:269,293` | `codex-event-translator.spec.ts:411,446` |
| D5: post-terminal usage dropped | Kept turn checkpoint and terminal status; emitted late usage evidence | `codex-event-translator.ts:300,389,427` | `codex-event-translator.spec.ts:482` |
| D6: timestamp nondeterministic | Injected optional clock, defaulting to `Date.now` | `codex-event-translator.ts:150,310` | `codex-event-translator.spec.ts:364` |
| D7: missing edge cases | Added cache-write, late usage, reset recovery and empty-usage cases | `codex-event-translator.spec.ts:421,446,458,482` | Those four cases |
| D8: types absent from package surface | Re-exported counters, evidence and diagnostic | `src/index.ts:22` | Static export inspection |
| D9: terminal evidence meaning unclear | Documented last accepted versus last observed evidence | `codex-event-translator.ts:376` | `codex-event-translator.spec.ts:389` |

`codex-chat-events.ts:272-283` treats `usage: {}` as a no-op for outward token deltas because input and output are absent.

## Open risks

- The pinned protocol has no reset marker. Current native counter decreases stay stale; the explicit-marker rebase path is ready for a compatible future native version.
- Cache-write inclusion is unverified. Evidence with cache writes is marked `cacheSemanticsAmbiguous`; pricing must treat it as partial until native semantics are confirmed.
- The pinned usage notification lacks parent and model fields. `codex-context.ts:404-410` filters child and post-terminal usage before host consumers. Batch 2 must preserve those events for U3.
- A fresh translator still derives the first turn delta from `total - last`; the later durable owner must reconcile persisted lifetime checkpoints.
- Tests, typecheck, lint, build and diagnostics were prohibited and were not run. Host compilation is therefore unverified.

## Verification and degradation audit

`git diff --check` passed. All five edited source files and this report have LF line endings and no BOM or CR characters. `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0 after Revision 1, reporting 279 existing unsuppressed sites against baselines and none in the edited files.