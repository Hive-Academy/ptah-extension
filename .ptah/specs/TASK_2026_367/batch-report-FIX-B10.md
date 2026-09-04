# TASK_2026_367 — batch report FIX-B10 (review finding F1, HIGH)

Fixes the wave-2 review finding F1 against batch B10 (C5c synthesized
`message_start`). The B10 change itself is kept: a `content_block_start` that
arrives before any `message_start` still synthesizes one. What is added is the
reconciliation of the REAL `message_start` that follows.

## The defect

An early `tool_use` synthesized message A, stored the real tool-call id under
A, and emitted `tool_start(A, tool-call-1)`. A following real `message_start`
ran the unchanged fresh-message path: it set a new id B and called
`clearToolCallIdsForContext`. The next `input_json_delta` therefore emitted
`tool_delta(B, tool-block-0)` — orphaned from its `tool_start` by BOTH ids —
and `message_stop` completed only B, leaving A open forever. Subagent contexts
used the same context-indexed maps and inherited the defect.

## Reconcile strategy: KEEP A (the synthesized id). Do not migrate.

`reconcileSynthesizedStart` (`stream-event.transformer.ts:200-251`) keeps the
synthesized message id and the whole block-index → tool-call-id map, emits NO
second `message_start`, and clears the synthesized mark. It folds in only
`message.model`, because the synthesized start had none. Usage on the real
start is still recorded, before the branch.

Why keep A rather than migrate to `message.id`:

1. The id is a correlation key, not an identity the SDK owns downstream. It was
   ALREADY published to every consumer on the emitted `message_start`,
   `tool_start` and `thinking_start`.
2. Migrating would mean re-keying every piece of consumer-side state that
   already holds A — tool ids, active-skill ids, the frontend's per-message
   block registry. That is a second correlation problem invented to solve the
   first one.
3. Keeping A needs no re-keying anywhere and produces exactly one balanced
   `message_start` / `message_complete` pair.

Everything the fresh-message path does that would BREAK correlation is skipped:
no `clearToolCallIdsForContext` (the early `tool_use` mapping must survive so
its `input_json_delta` resolves the real id), and no
`clearActiveSkillToolUseIds` (a `Skill` block in the same message is still
active).

Turn phase: the reconcile path still calls `markGenerating`, which the REAL
`SessionTurnStateRegistry` dedupes with `generatingEmitted`. In the normal case
it returns `null` and the path emits nothing. It can only fire when the
synthesis itself ran without a session id. So the phase flips exactly once
across synthesized + real start.

## Where the flag lives

`TransformerState` gained three members beside the per-context message id:
`isMessageSynthesized`, `markMessageSynthesized`, `clearMessageSynthesized`.
`SdkMessageTransformer` implements them with one `Set<string>`
(`synthesizedMessageContexts`), cleared by `clearMessageId` (so the mark cannot
outlive the message it describes) and by `clearStreamingState`. No module-level
map.

The transformer touches the new state only where it must: `isMessageSynthesized`
is read only when a message id is already active, `markMessageSynthesized` is
written only on the synthesized path, and `clearMessageSynthesized` is called
only inside the reconcile.

## Files modified

| File                                                                                      | Change                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/backend/agent-sdk/src/lib/message-transform/stream-event.transformer.ts`            | `onMessageStart` gained a `synthesized` flag and the reconcile branch; new `reconcileSynthesizedStart`; the inline `message` shape extracted to a `StreamStartMessage` interface reused by both. |
| `libs/backend/agent-sdk/src/lib/message-transform/transformer-state.ts`                   | Three new port members, documented.                                                                                                                                                              |
| `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`                               | `synthesizedMessageContexts` set, the three implementations, cleanup in `clearMessageId` and `clearStreamingState`.                                                                              |
| `libs/backend/agent-sdk/src/lib/message-transform/stream-event.synthesized-start.spec.ts` | Mock state implements the three members; five regression tests added; one existing assertion updated (see deviations).                                                                           |

### Deviation from the assigned file set (necessary, compile-only)

Adding three required members to `TransformerState` broke four sibling mock
literals that cast with `as jest.Mocked<TransformerState>` (not `as unknown
as`), so their suites failed to compile. Three additive lines were added to
each mock and nothing else:

- `assistant-message.transformer.spec.ts`
- `system-message.transformer.spec.ts`
- `user-message.transformer.spec.ts`
- `stream-event.transformer.spec.ts`

`assistant-message.transformer.ts`, `claude-sdk.types.ts` and
`content-block-contract.spec.ts` were NOT touched. Neither were
`cli-agent-runtime`, `platform-core` or `off-thread-process-spawner*`.

The alternative — making the three port members optional and calling them with
`?.` — was rejected: it makes a state that silently does not implement them
degrade back to the F1 behavior with no compile signal.

### One existing assertion changed

The existing lifecycle test `synthesize, then a real message_start, then
message_stop` asserted `complete.messageId === 'real-msg-id'`. That literal
encodes the defect (the real start opening a second envelope). It now asserts
the kept synthesized id. `complete.model === 'claude-3-7-sonnet'` still holds,
because the reconcile folds the model in. Every other existing test is
unchanged and passing.

## Spec assertions added

New `describe` block: `F1 regression: a real message_start reconciles with a
synthesized one`.

- **(a) root** — early `tool_use` → real `message_start` → `input_json_delta`
  → `message_stop`. Asserts exactly ONE `message_start` and ONE
  `message_complete`; `tool_delta.toolCallId === 'tool-call-1'` and
  `!== 'tool-block-0'`; `tool_delta.toolCallId === tool_start.toolCallId`;
  `tool_delta.messageId === tool_start.messageId === <synthesized id>`;
  `message_complete` carries the same id plus the real start's model; the
  context message id is cleared afterwards.
- **(b) subagent** — the same sequence under `parent_tool_use_id`, plus
  `parentToolUseId` attribution on the delta and `markGenerating` never called.
- **(c) Skill** — an early `Skill` `tool_use` is still tracked after the real
  start: `hasActiveSkillToolUseId` true, count 1, and
  `clearActiveSkillToolUseIds` never called.
- **(d) real registry** — the REAL `SessionTurnStateRegistry` (constructed, not
  mocked) is injected as `helpers.turnState`. Synthesized start + real start
  emit exactly one `turn_state` with phase `generating`, and exactly one
  `message_start`.
- **(e) synthesized then stop** — a synthesized start followed directly by
  `message_stop` emits one `message_complete` with the synthesized id, and both
  the message id and the synthesized mark are cleared.

## Pre-fix failure observed

The reconcile branch was temporarily disabled in place (its condition replaced
with `(false as boolean)`, which keeps the `activeMessageId` narrowing so the
file still compiles) and the spec was run. No git command was used.

`npx jest --config libs/backend/agent-sdk/jest.config.ts --testPathPatterns
"synthesized-start"` → **Tests: 5 failed, 8 passed, 13 total**. The failures:

- (a) root: `expect(starts).toHaveLength(1)` → **Received length: 2** — two
  `message_start` events, `messageId: aaaaaaaa-…` and `messageId: real-msg-id`.
- (b) subagent: identical, `cccccccc-…` and `real-msg-id`.
- (c) Skill: `hasActiveSkillToolUseId('skill-tool-1')` → **false**; the real
  start had cleared the active-skill set.
- (d) real registry: two `message_start` events. The `generating` count was
  already 1, because the registry's `generatingEmitted` guard held — so the
  duplicate ENVELOPE, not the phase, was the failure.
- The existing lifecycle test: `complete.messageId` → **`"real-msg-id"`**
  instead of the synthesized id.

Note on (a)/(b): the duplicate-`message_start` assertion fails first, before
the `tool_delta.toolCallId` assertion is reached. Both assertions are present
and both pass after the fix.

The branch was then restored from the backup copy and the fix verified.

## Verification (after the fix)

```
npx nx run-many -t test -p @ptah-extension/agent-sdk --skip-nx-cache
  NX  Running target test for project @ptah-extension/agent-sdk
  Test Suites: 1 skipped, 84 passed, 84 of 85 total
  Tests:       2 skipped, 1374 passed, 1376 total
```

The wave-2 review recorded a pre-fix baseline of 1369 passed + 2 skipped. The
delta is exactly +5, the five tests added here.

```
npx nx run-many -t lint -p @ptah-extension/agent-sdk --skip-nx-cache
  ✖ 42 problems (0 errors, 42 warnings)
  NX  Successfully ran target lint for project @ptah-extension/agent-sdk
```

None of the 42 warnings is in a file this batch touched. They fall in
`off-thread-process-spawner.ts`, `sdk-model-service.ts`,
`sdk-query-options-builder.ts`, `sdk-agent-adapter.ts`,
`sdk-permission-handler.ts` and three unrelated spec files.

All four changed files were formatted with `npx prettier --write`. No `git
add`, `commit`, `stash`, `checkout`, `reset` or `nx format:write` was run.

## Left undone / noted

- **`typecheck` for `@ptah-extension/agent-sdk` fails, and NOT because of this
  batch.** The single error is
  `off-thread-process-spawner.ts(613,9): error TS2345: Argument of type
'SpawnOptions' is not assignable to parameter of type 'SpawnPlan'` — a file
  another agent is editing in this working tree right now. Every file this
  batch touched compiles clean (ts-jest type-checks all 84 suites on the test
  run). `typecheck` was not one of the required gates.
- **Residual behavior, deliberate**: the synthesized mark is cleared by
  `message_stop`, by the reconcile, and by `clearStreamingState`. If a
  synthesized message NEVER receives a `message_stop` and a genuinely new
  assistant message starts in the same context, that new start reconciles into
  the stale message instead of opening its own. The pre-fix code had the mirror
  version of the same dependence on `message_stop` (it left message A
  permanently uncompleted). Closing it fully would need a turn boundary the
  transformer does not currently see.
- F2, F3 and F4 of the wave-2 review (all LOW, all batch B8) are out of scope
  here and untouched.

DONE: FIX-B10 — a real message_start now reconciles into the synthesized message instead of opening a second envelope, so tool_start and tool_delta keep one message id and one tool-call id
