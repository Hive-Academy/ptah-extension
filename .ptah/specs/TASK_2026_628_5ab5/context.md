# Context: cut renderer memory churn from streaming, sub-agent trees and CLI agent output

## Symptom

The Electron app becomes slow with 5–6 concurrent sessions that run many
sub-agents and CLI lanes. Windows Task Manager shows one Ptah process at
about 4 GB.

## Measurements (2026-10-11, one live Electron session)

Process breakdown (`Win32_Process`, private bytes):

| Process | Before snapshot | Just after snapshot |
|---|---|---|
| renderer | **5,582 MB** | **2,997 MB** |
| main | 634 MB | 1,424 MB (about an hour later) |
| gpu-process | 600 MB | 635 MB |

Heap snapshot `tmp/Heap-20261011T194217.heapsnapshot` (renderer, 206 MB file,
not committed):

- Live JS + DOM self size: **156.5 MB** (Blink native nodes: 91.1 MB).
- Detached DOM: 35,140 nodes, **3.9 MB**.
- Large strings: 125 strings over 20 KB, 9.6 MB in total (tool outputs, file dumps).

Conclusions:

1. **Allocation churn is the cause, not retained data and not paint.** Taking
   the snapshot forces a full GC. That GC freed about 2.6 GB, so that much was
   dead data that V8 had not collected yet. The live heap is small. The GPU
   process (paint and compositing) did not change.
2. About 2.8 GB stays after GC and is outside the snapshot: committed V8 pages
   that V8 has not given back, plus native memory. `performance.memory`
   (`usedJSHeapSize` against `totalJSHeapSize`) in the renderer console splits this.
3. **Detached canvas tiles leak, but the leak is small.** The two detached
   `gridstack-item` trees (18,898 and 1,526 nodes, with `chat-msg-slot`
   children) come from removed canvas tiles. Retainer paths:
   - One is held by `blink::ContextMenuController` (Chromium keeps the last
     right-clicked node). This is harmless.
   - One is held by an Angular `ElementRef.nativeElement` in a JS array. This
     is a real leak in our code.
4. The main process also grows (634 → 1,424 MB). This matches the earlier
   main-process handle-leak observation. It is **out of scope** here. File it
   separately if it continues.

## Hot spots (code read, ranked by likely garbage)

Found by reading the code, then spot-checked. Confirm the ranking with an
allocation-sampling profile before the fix (see Plan step 0).

1. **The execution tree is rebuilt in full on every frame. Its reuse cache never hits.**
   - `batched-update.service.ts:190` publishes `setStreamingState(tabId, { ...state })`.
     This is a new object on every rAF flush.
   - `execution-tree-builder.service.ts:310` reuses work only when
     `cached.indexState === streamingState`. The comment at `:303-307`
     assumes that the streaming path keeps the same object, but the flush
     breaks that assumption (spot-checked).
   - **Work per frame, per streaming tab:**
     - `buildStreamingIndexes` over up to 5,000 events (`:523`).
     - Every root message node is rebuilt (`:350`).
     - A fingerprint walk runs (`:393`), and ancestors are copied (`:600`).
     - `JSON.parse` runs on every completed tool input
       (`chat-execution-tree/builders/tool-node.fn.ts:176,271`).
     - Sorts run in `message-node.fn.ts:89,155` and `tool-node.fn.ts:89`.
   - **Sub-agents multiply the cost.** The work is O(whole tree), so every
     sub-agent subtree is rebuilt. Even with the cache fixed:
     - `computeRootDigests` (`:571`) folds descendant revisions into the root,
       so one sub-agent token rebuilds its whole root and all sibling agents.
     - `computeGlobalEpoch` (`:553-568`) mixes in agent summary length and
       block count, so any summary chunk invalidates every root.
2. **Streaming markdown is sanitized again in full on every frame, and its
   DOM is replaced.**
   - `markdown/src/lib/streaming-markdown-renderer.ts:18` runs
     `sanitizeFullMarkdownHtml(completedHtml + tail)` (DOMPurify over all the
     accumulated HTML) on each render (spot-checked).
   - The result is bound through `[innerHTML]` (`execution-node.component.ts:226`),
     so each frame discards the child DOM and builds it again.
   - A rAF throttle exists (`execution-node.component.ts:116,512-535`), but it
     limits the frequency, not the quantity of work. Each streaming sub-agent
     text node pays this cost too.
3. **Agent summary chunks bypass batching.**
   - `chat-lifecycle.service.ts:186-196` handles each `AGENT_SUMMARY_CHUNK`:
     it concatenates the summary, copies the blocks array, and calls
     `setStreamingState({ ...state })`.
   - This skips `BatchedUpdateService` and its visibility gate, and it bumps
     the global epoch, which forces hot spot 1.
4. **CLI agent output (`AGENT_MONITOR_OUTPUT`) does full-size work on each delta.**
   - The only throttle is the backend flush every 200 ms per agent
     (`agent-process-manager-helpers.ts:116`). The frontend has no batch
     (`agent-monitor-message-handler.service.ts:36`).
   - `agent-monitor.store.ts:1276-1363` clones the agent and copies the list,
     `_byId` (`:664`), `agents` (`:794`), `storeAgentIds` and the segments array.
   - Past the 50 KB cap, `capBuffer` (`agent-output-retention.ts:64-76`)
     creates a new ~50 KB string on each delta.
   - `agent-card.component.ts:152` / `agent-card.utils.ts:45` parse all of
     stdout and stderr again.
   - `keyedSegments` (`agent-card-output.component.ts:332-346`) keys segments
     by length and prefix, so views are destroyed and created again, and text
     segments re-run `<markdown>` without a throttle (`:295`).
   - `AgentMonitorTreeBuilderService.assembleTree` (`:520-618`) is
     O(messages × blocks) and calls `JSON.parse` on every tool input (`:642`).
5. **Copies in the tab and presentation layers on every frame.**
   - `tab-manager.service.ts:1321-1338` copies the tab and the whole `tabs`
     array on each flush.
   - `stream-presentation-store.service.ts:118-131,180` creates new arrays,
     sets and message objects on each sync.
   - Canvas tiles use a different tree cache key (`tile-…`,
     `chat-transcript.component.ts:405`), so the same state can be built twice.
6. **`summarizeLive` is quadratic (compact view only).**
   - `compact-session-summary.ts:155-186` runs `redactAbsolutePaths` (four
     replaces) on the full accumulated block text for every `text_delta`.
   - It also re-parses tool inputs (`:320`) and sorts on each publish.
   - TASK_2026_629_c0b3 makes compact view the default for unfocused tiles, so
     this hot spot becomes more important.
7. **Detached-tile leak:** find the array that holds the `ElementRef` of a
   destroyed `ptah-canvas-tile` (check the canvas grid/Gridstack adapter and
   any tile registries) and release it on destroy.

## Plan

0. **Profile first.** Take a 60 s DevTools Memory "Allocation sampling" profile
   with 5–6 sessions streaming, and run `performance.memory` before and after.
   Save the `.heapprofile` in this folder (or `tmp/`). Re-rank the hot spots
   above with the real numbers.
1. Make streaming reuse incremental. Remove the `{ ...state }` copy in the
   flush, or key the tree cache on a state revision instead of object identity
   (keep the TASK_2026_336 guarantee for real state replacement). Make one
   sub-agent update rebuild only its own subtree path, not the whole root, and
   remove summary length and block count from the global epoch.
2. Streaming markdown: sanitize only the newly completed part and the tail,
   and append to the DOM instead of replacing the full `innerHTML`.
3. Route `AGENT_SUMMARY_CHUNK` through `BatchedUpdateService`.
4. CLI agent output: batch `AGENT_MONITOR_OUTPUT` per frame on the frontend,
   update the store without copying the full list, parse stdout incrementally,
   key segments by a stable id, and throttle segment markdown.
5. Cache tool-input `JSON.parse` results per tool id (tree builder, monitor
   tree builder, compact summary).
6. Make `summarizeLive` linear (redact each block once), and sample it.
7. Fix the detached-tile `ElementRef` leak.

## Acceptance

- Same scenario as the measurements (5–6 sessions with sub-agents and CLI
  lanes, about 30 min): renderer private memory stays under an agreed ceiling
  (proposal: 1.5 GB), and a forced GC frees less than 25% of it.
- The allocation rate in a 60 s sampling profile drops by at least 50%
  against the step-0 baseline.
- One sub-agent token delta does not rebuild sibling sub-agent subtrees
  (unit test on the tree builder).
- No detached `ptah-canvas-tile` / `gridstack-item` tree after a tile closes
  (heap snapshot check).
- No regression in TASK_2026_336 (a replaced state is never reused).
- Record the before and after numbers in this folder.

## Out of scope

- The canvas layout redesign (TASK_2026_629_c0b3).
- Main-process memory growth.
- A `--max-old-space-size` cap as the fix. It can be a temporary mitigation
  only: it costs GC CPU and crashes the renderer if live data exceeds it.

## Verification rules

Follow CLAUDE.md: test only the changed projects (for example
`npx nx test chat-streaming`, `npx nx test markdown`, `npx nx test chat`),
Jest `--maxWorkers=2`, Nx `--parallel=1`, one heavy check at a time, no build,
serve or e2e targets unless the user asks.
