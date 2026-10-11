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

### Follow-up measurement (20:27, same renderer, app 0.1.70)

- `performance.memory`: `totalJSHeapSize` 103 MB, `usedJSHeapSize` 81 MB.
  At the same time, the renderer has **2,900 MB private**.
- So **more than 95% of the renderer memory is not V8 JavaScript objects.** It
  is native memory: Blink's DOM and layout heap (Oilpan), PartitionAlloc and
  malloc, and allocator pages that churn keeps committed after objects are freed.
- **This raises hot spot 2 to first place.** DOMPurify parses HTML into DOM
  nodes, and `[innerHTML]` replacement creates and drops DOM and layout objects
  every frame. All of these allocate in Blink, not in V8. Hot spot 1 (tree
  rebuild) is mainly V8 garbage and CPU cost. Still fix it, but do not expect
  it to explain the GBs alone.
- The allocation-sampling profile (`tmp/Heap-20261011T202717.heapprofile`)
  recorded only 3.7 MB in 178 samples. It held only surviving objects, so it
  cannot rank the churn. Record it again with "Include objects discarded by
  major/minor GC" selected.
- Next evidence to collect:
  1. `process.getBlinkMemoryInfo()` and `await process.getProcessMemoryInfo()`
     in the "Electron Isolated Context" of the DevTools console.
  2. A Performance recording with **Memory** selected, to see the DOM node
     count and the JS heap over time while streaming.

### Performance trace (20:34, `tmp/Trace-20261011T203430.json`, 26 s while streaming)

| Measurement | Value |
|---|---|
| Main thread: Rendering / Scripting | **23,393 ms** / 1,069 ms of 25,854 ms |
| Recalculate Style (`UpdateLayoutTree`) | **81 runs, 18,146 ms, average 224 ms**, average 12,823 elements, max 28,916 |
| Layout | 40 runs, 338 ms (cheap) |
| Layerize / PrePaint / Paint | 3,864 / 1,202 / 870 ms |
| DOM nodes (one document) | 104,832 → 108,817 |
| Documents | **30 → 50** |
| JS heap used | 87.9 → 88.1 MB (flat) |
| Frames | about 1 s each at the worst (1,450 / 1,066 / 967 / 950 ms) |

Conclusions:

1. **The slowness is style recalculation over a very large DOM, not
   JavaScript.** Almost every frame restyles about 13,000 elements and costs
   about 224 ms, so the UI runs at about 3–4 frames per second. 30 of the 36
   recalculations over 100 ms run in the frame's rendering step and are not
   forced by script. Only 1 s of the 26 s is scripting.
2. **The DOM is about 105,000 nodes.** All the live transcripts, sidebars and
   agent panels of all the canvas sessions are mounted at the same time. The
   cost of a recalculation scales with the number of elements that it touches.
   This is the direct performance case for TASK_2026_629_c0b3 (one live view,
   summary cards for the others).
3. **The document count increases by about 0.8 per second.** DOMPurify creates
   a new `Document` for each `sanitize()` call
   (`new DOMParser().parseFromString`, `dompurify/dist/purify.es.mjs:1470`).
   `sanitizeFullMarkdownHtml` runs on every streaming frame (hot spot 2), so
   each frame creates and drops a whole parsed document in Blink memory. This
   matches a renderer that is 2.9 GB with a 103 MB JS heap.
4. **Hover over the sidebar restyles the whole sidebar and starts transitions.**
   - `apps/ptah-extension-webview/src/styles.css:2221`
     (`aside:not(:hover) .sidebar-scroll { scrollbar-color: transparent transparent; }`)
     changes `scrollbar-color` when the pointer enters or leaves the aside.
   - `scrollbar-color` is inherited, so every descendant changes too. Every
     button with `transition-all` then starts a main-thread `scrollbar-color`
     transition. The trace shows 36 + 24 + 9 + 5 such transitions on sidebar
     buttons in 26 s.
   - The same defect was fixed once before in `effort-selector.component.ts:124-126`.
   - Fix: replace `transition-all` with `transition-colors` (or a narrower
     property list) on these elements. Do not toggle an inherited property on
     `:hover` of a large subtree.
5. **Next evidence:** record about 10 s again with the Performance settings
   **Enable CSS selector stats** and **Enable advanced rendering
   instrumentation**. The selector stats show which selectors cost the most in
   each recalculation. The invalidation tracking shows which DOM changes
   schedule them.

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
