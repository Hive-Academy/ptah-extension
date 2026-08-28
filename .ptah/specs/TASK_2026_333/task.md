---
id: TASK_2026_333
status: in_progress
type: BUGFIX
title: >-
  The execution-tree cache folds the background-agent set by size, so two agents
  swapping background state in one frame both render the wrong flag
priority: high
description: >-
  Confirmed regression introduced by TASK_2026_323 Phase 3. `computeGlobalEpoch`
  folds `backgroundAgentStore.backgroundToolCallIds().size`
  (`execution-tree-builder.service.ts:518-521`) — the size, never the membership.
  The three `background_agent_*` events call the store and return `mutated()`
  without touching `setStreamingEventCapped` or `indexEventByMessage`
  (`accumulator-core.service.ts:568-576`), so they bump no `messageRevisions`
  entry and change no `eventsByMessage` bucket length, which are the only two
  inputs to `computeRootDigests`. Meanwhile `isBackground` is read LIVE at build
  time via `deps.backgroundAgentStore.isBackgroundAgent(toolCallId)`
  (`agent-node.fn.ts:114`, `tool-node.fn.ts:397`). `BatchedUpdateService`
  coalesces mutations into one flush per frame, so if agent A enters the
  background set while agent B leaves it in the same frame the size is
  unchanged, no digest moves, `reusableRootNode` returns both cached nodes
  verbatim, and both cards render the opposite of their real background state
  until an unrelated delta touches that specific root. Folding a size is correct
  for a map that only grows and wrong for a set whose membership can change while
  its size does not. The reason this shipped is the second half of the task: no
  test builds a tree incrementally and asserts equality against a full rebuild of
  the same event sequence, and the old full-rebuild path was deleted, so no
  oracle remains.
relates_to:
  - TASK_2026_323
labels:
  - chat-streaming
  - chat-execution-tree
  - regression
  - cache-invalidation
executor: frontend-developer
estimate: S
---

# Stale isBackground survives execution-tree cache reuse

Machine-owned metadata carrier. Prose lives in `./context.md`.
