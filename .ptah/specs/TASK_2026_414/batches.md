# TASK_2026_414 — Sequential Codex implementation batches

Read `implementation-plan.md` first. Worktree: `D:/projects/ptah-extension/.claude-worktrees/compaction-ui-consistency` at reviewed HEAD `5f79f5ad8`. Executor: the user-requested Ollama Cloud CLI (`pc-85830910-3d81-4248-84c1-4fa52752dd19`), with no substitute provider. No commits, pushes, app restart, live-session/log edits, `git reset`, or bare `git stash`. Run one batch at a time; use the stated `run-many` command and confirm its project count.

## Batch 1 — Backend: one immutable resume generation

Files:

- `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
- `libs/backend/agent-sdk/src/lib/helpers/compaction-boundary-generation-registry.ts` (new)
- `libs/backend/agent-sdk/src/lib/di/tokens.ts`
- `libs/backend/agent-sdk/src/lib/di/register.ts`
- `libs/backend/agent-sdk/src/lib/message-transform/transformer-helpers.ts`
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`
- `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.ts`
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- `libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts` (only if its enumeration pins `ChatResumeResult`)
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/compaction-boundary-generation-registry.spec.ts` (new)
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-resume-activate.spec.ts`

Implement the single-parse result (`events`, text messages, stats) and make `chat:resume` consume it. Keep the legacy text and curation APIs. Add only the bounded generation registry described in the plan: reader captures a pending expectation before recording the current parsed boundary count; a resolved compact-boundary transform requests the next count; inject that singleton into `SdkMessageTransformer` and preserve it through `createIsolated()`; compaction resume retries by event-loop yield only while the count is short; no timestamps, TTL, delay constants, or slack. Consume expectation after response. Return additive `staleSnapshot?: true` when no baseline or no expected count is observed; leave ordinary and stats-only reads unchanged.

Tests must pin: one parse supplies events/messages with the same boundary; ready after a file-generation change; exhausted and baseline-absent results are stale; no expectation leaves the flag absent; transformer records only after session-id resolution; resume no longer calls the second reader and forwards the flag; shared-wire shape only if it enumerates this result. Update the JSONL cache comment to the one-read `chat:resume` rule.

Gate:

```bash
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers
npx nx affected -t typecheck
```

Review: verify generation arithmetic, expectation consumption, cache behavior, and absence of clock-based acceptance.

## Batch 2 — Frontend: stale compaction snapshot containment

Files:

- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`

For a targeted compaction reload with `staleSnapshot === true`, after ownership is re-validated and before any payload application, restore loaded/idle state and return normally. Preserve the marker and preloaded stats; do not apply events, messages, stats, CLI sessions, or resume-derived subagents. Normal resumes consume no special meaning from the flag. Do not add a retry, timer, or mutate existing dedup/ownership/pending-update behavior.

Tests: stale compaction response is not applied and is not left `resuming`; absent flag applies normally; stale normal resume applies normally; same target deduplicates; rebinding/closure causes ownership failure.

Gate:

```bash
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state
npx nx affected -t typecheck
```

Review: pending-settle still completes and no targeted tab can remain stuck.

## Batch 3 — Frontend: independent compaction safety timers

Files:

- `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.spec.ts`

Replace the singleton timer with a per-session map. Preserve 600000 ms and existing completion fan-out. Start/restart clears only that session; complete clears only that session; per-tab clear removes entries for its current conversation; sweep clears all; callback deletes itself and skips tabs no longer bound to its captured session.

Tests: two sessions arm independently; A completion leaves B armed; A timeout only resets A; tab clear is scoped; sweep clears all; close/rebind during wait is skipped; repeated A starts do not leak a handle.

Gate:

```bash
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state
npx nx affected -t typecheck
```

Review: every terminal path removes the correct entry; do not touch fan-out or diagnostics.

## Batch 4 — Context seed and neutral compaction marker

Files:

- `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
- `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts`
- `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.spec.ts`

Forward existing `postTokens` to `applyCompactionComplete`. Seed context only with positive finite tokens and a known existing model; preserve cumulative/preloaded data and allow later live usage to replace the seed. Make non-shrinking marker values neutral.

Tests: valid seed; absent/zero/non-finite/no-model remains null; cumulative values survive; live frame replaces seed; decreasing/equal/increasing/null marker cases.

Gate:

```bash
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-ui
npx nx affected -t typecheck
```

Review: no synthetic zero and no PR490/provider-accounting overlap.

## Batch 5 — Artifact parity, test before filter change

Files:

- `libs/backend/agent-sdk/src/lib/message-transform/artifact-parity.spec.ts` (new, or the existing replay-spec location if that is the established fixture harness)
- `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts` only if the parity test proves a replay divergence
- associated focused replay/live specs only if required

Build the normalized visible-text parity corpus specified in the plan. Record the proven divergence in the test description/review note. Apply only the minimal proven filter correction; do not modify `No response requested.` based on hypothesis alone.

Gate:

```bash
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers
npx nx affected -t typecheck
```

Review: replay may gain a proven live filter; genuine content and compaction semantics remain intact.

## Completion gate

```bash
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-ui
npx nx affected -t typecheck
```

Confirm six projects in the full `run-many` header, no diagnostic warning removal, and no product changes outside these batches.
