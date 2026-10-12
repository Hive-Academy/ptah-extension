# Implementation plan: TASK_2026_628_5ab5

Cut renderer memory and CPU churn while many sessions stream.

- Branch: `fix/task-628-renderer-memory` (worktree `D:\projects\ptah-wt-628`), base `43803ee7e`.
- PR #704 (TASK_2026_623 display feed) and PR #706 (`fix/session-budget-handoff`) are
  already in the base. No rebase is expected for them.
- This file merges four architect parts (A, B1, B2, B3). The parts follow this
  header unchanged.

## Batch order

| Batch | Scope | Part | Depends on |
|---|---|---|---|
| 1a | Streaming markdown: sanitize each completed block once, keep its element; plain-text tail; add `ptah-markdown-root` wrapper on the streaming path | A | — |
| 1b | Sidebar transitions: narrow `transition-all` in `app-shell.component.html` (`:101`, `:254`, `:487`) | A | — |
| 2 | Tree cache keyed on the identity of the state's Maps; per-agent cache; summary fields out of `computeGlobalEpoch` into the owning root digest; TASK_2026_336 test kept + sibling-rebuild test added | A | — |
| 3 | `AGENT_SUMMARY_CHUNK` through `BatchedUpdateService` (update the queued state, never schedule an older one) | B1 | 2 |
| 4a–4e | CLI agent output: frame batch, one store write per frame, 2× cap trim, incremental parse, positional segment keys, tail markdown throttle, single-pass monitor tree | B1 | — |
| 5 | No-op copies in `updateTabInternal` (`tab-manager.service.ts:1354-1373`), memoized `StreamPresentationStore`, `tab-<id>` key for tiles, shared tool-input parse cache in `chat-types` | B2 | 2 |
| 6 | Linear `summarizeLive` (redact each block once, 256-entry cache, newest 48 items, no full sort) | B3 | 5 (parse cache, optional) |
| 7 | Detached tile leak: `removeWidget(el, false, false)` when the tile set changes, prune per-tile options, clear on destroy (`canvas-workspace-grid.component.ts`) | B3 | — |

Batches 1a and 1b ship together as the quick-win batch (user order).

## Cross-part resolutions (orchestrator)

1. **B1 Q1 (summary invalidation after Batch 2):** resolved by Part A. Batch 2 keeps the
   `{ ...state }` flush copy and moves the summary length and block count into the owning
   root digest. Batch 3 routes chunks through `BatchedUpdateService`, so each flush still
   publishes a new state object, and the owning root rebuilds. No extra revision field.
2. **A clarification 1:** session row uses `transition-[color,background-color,box-shadow]`.
3. **A clarification 2:** keep the `aside:not(:hover) .sidebar-scroll` selector.
4. **B1 clarification 2:** CLI segment tail markdown throttle 150 ms.
5. **Shared parse cache:** Batch 5 creates it in `chat-types`. Batches 4 and 6 adopt it
   only if Batch 5 has landed; otherwise they keep a local per-tool-id cache.

## Revision 1 (answers `implementation-plan-review.md`, round 1)

These rules override the parts below where they differ.

### R1. Measurement gates (review defect 1)

The user records the traces. The orchestrator analyzes them and writes
`measurements.md` in this folder. Use the same scenario each time: 5–6 sessions
streaming, with sub-agents and CLI lanes.

| Gate | When | Build | What to record |
|---|---|---|---|
| M0 baseline | Before Batch 1 lands | `main` at `43803ee7e` | (a) 60 s Memory "Allocation sampling" with "Include objects discarded by major/minor GC"; (b) ~26 s Performance trace with Memory, CSS selector stats and advanced rendering instrumentation; (c) `performance.memory`, `process.getBlinkMemoryInfo()`, `await process.getProcessMemoryInfo()` at start and end; (d) renderer private bytes (`Win32_Process`) at 0, 10 and 30 min, then again after a forced GC |
| M1 | After Batches 1a + 1b | this branch | Same as M0 (b) and (c). Compare document count growth, Recalculate Style count/avg/elements, and ParseHTML per frame |
| M2 | After Batch 2 | this branch | Same as M0 (a) and (b). Compare scripting time and allocation rate |
| M-final | After Batch 7 | this branch | Everything in M0, plus the Batch 7 heap-snapshot check (Part B3 section 5) |

Pass criteria for M-final (from `context.md` Acceptance):

- Renderer private memory at 30 min stays below the agreed ceiling. The proposal
  is 1.5 GB. **The user must confirm the ceiling at the plan gate.**
- A forced GC frees less than 25% of renderer private memory.
- The allocation rate in the 60 s sampling profile is at least 50% lower than M0.
- No detached `ptah-canvas-tile` or `gridstack-item` tree after a tile closes.

The trace files stay in `tmp/` (not committed). `measurements.md` records the
numbers, the file names and the pass/fail result.

### R2. Batch 4a: one ordered fold for hidden-window output (review defect 2)

- The store keeps the cumulative dropped-byte count per agent in a private
  `Map<agentId, number>`. It is not part of the public agent shape.
- Pending deltas hold raw output only. A pending trim at 2× cap removes bytes
  from the front of the pending string and adds them to the private count. It
  never writes a notice.
- The frame flush folds in this order: `agent.stdout` without its leading notice
  → append the pending raw text → one `capBuffer` call with the cumulative count.
  Only this final step writes the notice, and always at the start of the buffer.
- Tests (`agent-output-retention.spec.ts` and the store spec):
  1. A hidden interval that receives more than 2× cap, then one more trim, gives
     exactly one notice, at index 0, with the sum of all dropped bytes.
  2. No notice text ever appears after index 0.

### R3. Batch 7: release inside the authoritative apply (review defect 3)

Evidence: `GridStackEngine.removeNode` calls `_packNodes()` and `_notify()`
even when both flags are false (`node_modules/gridstack/dist/gridstack-engine.js:786-801`),
and the canvas grid uses `float: false` (`canvas-workspace-grid.component.ts:220`).
So a release can move live tiles.

- Do not release in a separate after-render step. Release stale nodes only inside
  `applyAuthoritativeGeometry` (`canvas-workspace-grid.component.ts:~720-800`),
  in the same `batchUpdate(true)` … `batchUpdate(false)` window and with
  `_applyingLayout = true`.
- Order in that window: (1) call `grid.removeWidget(el, false, false)` for each
  engine node whose id is not in the current tile set; (2) compute `changed`
  against the engine nodes after removal; (3) write the authoritative geometry.
  The final geometry is thus the derived layout, not the packing result.
- Never release while a gesture is active (`_gesture !== null`). Keep the stale
  node until the next apply.
- If the grid is hidden or locked and the apply is skipped, the stale node waits
  for the next apply. On `ngOnDestroy`, release everything (no live nodes remain).
- Test (`canvas-workspace-grid.component.spec.ts`): three tiles, close the middle
  one. After the apply, the engine has two nodes, their coordinates equal the
  derived layout, and the removed element has no engine node and no per-tile
  options. A second test closes a tile during an active gesture and checks that
  no release and no coordinate change happen until the gesture ends.

## Revision 2 (answers review round 1)

These rules replace the matching points of R2 and R3.

### R2.1. Separate dropped-byte counts per stream (round-1 new defect 1)

- Evidence: stdout and stderr are capped independently
  (`agent-monitor.store.ts:1290-1300`), and each buffer's notice carries its own
  count (`agent-output-retention.ts:64-75`).
- The private map is `Map<agentId, { stdout: number; stderr: number }>`. Each
  stream folds and caps with its own count only.
- Extra test: both streams trim in the same hidden interval. Each notice holds
  only the bytes dropped from its own stream.

### R3.1. Release before the authoritative write, through the existing `load()` path (round-1 open defect 3)

Evidence: the apply writes geometry with `grid.load(items, false)`
(`canvas-workspace-grid.component.ts:793-803`). `load()` opens and closes its
own batch, and closing the batch packs (`gridstack.js:652`, `:717`, `:730-737`;
`gridstack-engine.js:47-62`). So the R3 "one batch" rule cannot hold and is
withdrawn.

New order inside `applyAuthoritativeGeometry`, with `_applyingLayout = true`:

1. Release: call `grid.removeWidget(el, false, false)` for each engine node whose
   id is not in the current tile set. Skip this step while a gesture is active
   (`_gesture !== null`).
2. Compute `changed` against the engine nodes **after** the release. If the
   release packed a live tile, its coordinates now differ from the derived layout,
   so `changed` is not empty.
3. Write the geometry with the existing `grid.load(..., false)` call (unchanged).

Argument: after step 3 the engine holds the same derived snapshot that every
apply writes today, through the same `load()` call. Any pack at the close of
`load()` also happens today without this fix. The release adds no packing after
the authoritative write.

Drift check (diagnostic only, no correction loop): after step 3, compare each
engine node with its derived target. On a mismatch, call
`this.metrics.increment('geometryDrift')`. Do not apply again in the same pass.

### R3.2. Empty tile set (round-1 new defect 2)

- Evidence: `applyAuthoritativeGeometry` returns at `positioned.length === 0`
  before it gets the grid (`canvas-workspace-grid.component.ts:741-746`).
- Before that early return, get the grid if it exists and release every engine
  node (the same gesture guard applies). There are no live tiles, so packing has
  no effect.
- Extra test: close the last tile while the workspace stays mounted. The engine
  has no nodes, and the closed element has no per-tile options.

### R3 tests (replace the R3 test list)

In `canvas-workspace-grid.component.spec.ts` (mock grid):

1. Three tiles, close the middle one. `removeWidget` is called before `load`.
   `load` gets the derived geometry of the two live tiles. After the apply, the
   engine coordinates equal the derived layout.
2. Close a tile during an active gesture. No `removeWidget` call and no
   coordinate change happen until the gesture ends. The next apply releases it.
3. Close the last tile (R3.2).
4. The drift metric is not incremented in tests 1–3.

## User decisions at the plan gate (2026-10-12)

- Plan approved for Batches 1–6 with Revisions 1–2.
- **Batch 7 (hot spot 7) moves to TASK_2026_629** with the review findings
  (`implementation-plan-review-r1.md`, `implementation-plan-review-r2.md`). 628
  edits no canvas file. The acceptance item "no detached `ptah-canvas-tile` /
  `gridstack-item` tree after a tile closes" leaves 628, and the M-final
  heap-snapshot check is dropped from 628. R3, R3.1, R3.2 below are kept only as
  input for 629.
- Memory ceiling: **1.5 GB** renderer private memory at 30 min, and a forced GC
  frees less than 25%.

## Open items after the review cap (round 2, `implementation-plan-review-r2.md`)

The revise cap (2 rounds) is reached. These items go to the user.

1. **Blocking, fix known.** R3.2 must release only when the current tile *set*
   (the intent) is empty, not when `positioned.length === 0`. `computeLayout()`
   also returns no tiles when the measured width or height is zero
   (`canvas-layout.service.ts:141-143`). Add a test: zero-size measurement with
   live tiles releases nothing.
2. **Open, needs a decision: Batch 7 and row-break gaps.** With `float: false`,
   both `removeWidget` and the batch close inside `load()` pack nodes upward
   (`gridstack-engine.js:427-465`). When the derived layout keeps a row-break
   gap (`canvas-layout-intent.ts:568-610`), a released stale node no longer
   fills that gap, so a live tile below can move up against the derived layout.
   Today the leaked stale node holds the gap open by accident. Options:
   - A. Move hot spot 7 to TASK_2026_629, which owns the canvas layout and
     Gridstack use, with this review attached. 628 drops the "no detached tile"
     acceptance item. (Orchestrator recommendation.)
   - B. Keep Batch 7 in 628 with an extra design step: run the release and
     `load()` with the engine in float mode, and prove with a test on the real
     GridStack engine (not the mock) that row-break gaps stay.
   - C. Defer hot spot 7 to a new follow-up task.

## Coordination with TASK_2026_629 (parallel session)

- 628 makes `summarizeLive` linear and adds no sampler. 629's 500 ms sampler in
  `CompactSessionCardComponent` must not be gated to the canvas, because the same card
  renders the compact main panel.
- Batch 7 edits `canvas-workspace-grid.component.ts` (non-layout lifecycle only). 629 must
  rebase over it.
- Batch 4 keeps the public signal names and shapes of `AgentMonitorStore`.
- Batch 5 makes tiles use the `tab-<id>` tree key, so a 629 detail row shares the build.
- Answers to the 629 plan gate (Q1–Q8), binding on 628 implementers:
  - Batch 5 test: extend the "one `buildTree` per published tab snapshot" test to
    two ChatViews of the same tab in the same frame (exactly one build).
  - Batch 5: skipping the copy in `updateTabInternal` applies only when nothing
    changed. Every status change, including turn-in-flight, still publishes.
  - Batch 6: keep the `summarizeLive` and `summarizeFinalized` signatures.
  - Batch 4: keep the public `AgentMonitorStore` API, including how
    `agent.expanded` is set.
  - Batch 7: edit only `canvas-workspace-grid.component.ts` regions in R3.1/R3.2
    plus the per-tile options pruning and `ngOnDestroy`. Do not touch the
    template, inputs or computeds that 629 edits, or `canvas-tile.component.ts`.

## Unverified items (implementers confirm, then record the result here)

- Angular `[innerHTML]` sanitizer creates a second Document per call (Part A).
- Why Chromium starts `scrollbar-color` transitions on sidebar buttons (Part A). The fix
  does not depend on it.
- `structuralRevision` behaviour on non-delta writes; forked states get fresh Maps (Part A).
- `storeAgentIds` location (Part B1).
- Four assumptions in Part B2 section "Assumptions".
- The exact JS retainer of the detached tile (Part B3). The heap snapshot confirms it.

## Lane-introduced constraints

Tagged `lane-proposed` (not in the user request or project rules):

- 256-entry limit on the redaction cache and the parse cache.
- Newest 48 items in the live summary.
- 2× cap before the CLI output buffer is trimmed.
- 150 ms tail markdown throttle for CLI segments.

## Verification (STRICT, CLAUDE.md)

- Test only changed projects: `npx nx test <project>`, `npx nx typecheck <project>`,
  `npx nx lint <project>`, or Jest on changed specs with `--coverage=false --maxWorkers=2`.
- Nx `--parallel=1`. One heavy check at a time (TASK_2026_629 runs on the same machine).
- No workspace-wide runs. No build, serve, dev, e2e or package targets.
- Filter output instead of re-running.

---


# Part A

# Plan part A - TASK_2026_628_5ab5 (Batch 1 and Batch 2)

Scope: hot spot 2 (streaming markdown), the sidebar CSS transitions, and hot
spot 1 (execution-tree reuse). Hot spots 3-7 belong to part B.

All paths are repo-relative to the worktree `D:\projects\ptah-wt-628`. Each
claim is labelled **V** (Verified, with file:line) or **A** (Assumption, with
the check that resolves it).

## 1. Verified hot-spot table

| # | Claim in context.md | Current location | Status |
|---|---|---|---|
| HS2a | The streaming renderer sanitizes all the accumulated HTML on every render | `libs/frontend/markdown/src/lib/streaming-markdown-renderer.ts:19`. `render()` returns `sanitizeFullMarkdownHtml(completedHtml + tail)`. The line is 19, not 18. | **V**, line corrected |
| HS2b | The sanitizer is DOMPurify with one Document per call | `sanitizeFullMarkdownHtml` is at `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:228-229` and uses the private instance from `:167-175`. In DOMPurify 3.4.15 (`node_modules/dompurify/dist/purify.es.mjs:473`), every string input goes through `_initDocument`, which runs `new DOMParser().parseFromString` (`:1470`). | **V** |
| HS2c | `[innerHTML]` replaces the DOM on every frame | `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:226-227`: `@if (incrementalStreamingEnabled && isNodeStreaming()) { <div [innerHTML]="streamingHtml()"> }`. Each new string is also passed through Angular's own DomSanitizer. That sanitizer parses the string into its own inert document (**A**: confirm in `node_modules/@angular/core` `InertBodyHelper`/`DOMParserHelper`). So today each frame creates up to two Documents for each streaming text node. | **V** (binding); second Document is **A** |
| HS2d | A rAF throttle limits the frequency of the work, not its size | `execution-node.component.ts:495-524`: an effect queues one `scheduleFrame`. `publishStreaming` (`:544-549`) then calls `streamingMarkdown.render(content)` and passes the whole string to `_streamingHtml`. | **V**, lines corrected (116 → 495-549) |
| HS2e | Rollback switch | `INCREMENTAL_STREAMING_PRESENTATION_ENABLED`, `libs/frontend/chat/src/lib/services/scroll-dirty.service.ts:4-7` (default `true`) | **V** |
| HS2f | Containment layer | Settled renders are wrapped in `ptah-markdown-root` with `contain: layout paint; isolation: isolate` (`provide-markdown-rendering.ts:200-225`). The streaming path calls `sanitizeFullMarkdownHtml` without that wrapper (`streaming-markdown-renderer.ts:19`), so Layer 1 is missing while a message streams. | **V** (new finding) |
| HS2g | Display fences (TASK_2026_623) | The `ptahUiHost()` branch comes before the incremental `@else` (`execution-node.component.ts:176-205`). It is decided from raw text and receives `renderedContent()`, not `streamingHtml()`. | **V**, so the design here does not reach it |
| CSS1 | `aside:not(:hover) .sidebar-scroll { scrollbar-color: transparent transparent }` | `apps/ptah-extension-webview/src/styles.css:2221-2223`. The base rule is at `:2216-2219`. | **V** |
| CSS2 | `scrollbar-color` is inherited, so all descendants change | **Corrected.** `styles.css:638-643` sets `* { scrollbar-width: thin; scrollbar-color: … }` on every element. A descendant of `.sidebar-scroll` has its own declared value and does not inherit the toggled one. So `.sidebar-scroll > * { scrollbar-color: … }` would change nothing. The trace instead shows `scrollbar-color` transitions starting on elements with `transition-all` whenever those elements are restyled, for example on their own hover. **A**: the cause is that Chromium treats `scrollbar-color` as changed on any restyle of such an element. `effort-selector.component.spec.ts:228-231` records the same observation from an earlier fix. | **V** for the rule; mechanism is **A** |
| CSS3 | Earlier fix | `libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.ts:124-126` (comment), `:134` (`transition-colors`). The regression test is `effort-selector.component.spec.ts:217-237`. | **V** |
| CSS4 | Sidebar elements with `transition-all` | `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:101` (the `<aside>` itself, `[class.transition-all]="!sidebarResizing()"`, which animates width), `:254` (each session row button, `hover:bg-surface-2`), `:487` (footer `btn btn-ghost`, hover colours only) | **V** |
| CSS5 | `chat-view.component.css:14`, `chat-transcript.component.css:12` | Static `scrollbar-color` on the scroll containers. No `:hover` toggle exists there. | **V**, no change needed |
| HS1a | The flush publishes a copy | `libs/frontend/chat-streaming/src/lib/batched-update.service.ts:190`: `setStreamingState(tabId, { ...state })`. The same pattern exists in `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts:196` (hot spot 3, part B). | **V** |
| HS1b | The reuse gate is object identity | `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:310` `sameStateObject = cached?.indexState === streamingState`. The rationale comment is at `:291-309`. The index memo has the same gate at `:516-521`. The value is stored at `:425` and released at `:779`. | **V**. Note the file is in `chat-streaming`, not `chat-execution-tree` |
| HS1c | Global epoch mixes summary length and block count | `execution-tree-builder.service.ts:551-569` (`:552-564` are the two loops) | **V** |
| HS1d | Root digests fold descendants into the root | `execution-tree-builder.service.ts:581-597` (`rootMessageIdByMessageId` at `:589`) | **V** |
| HS1e | A root rebuild rebuilds every agent under it | `reusableRootNode` (`:491-501`) works on whole roots. `buildMessageNode` → tool node → `deps.buildAgentNode` (`chat-execution-tree/src/lib/builders/tool-node.fn.ts:116,260`) → `buildAgentNode` (`builders/agent-node.fn.ts:26-130`) calls `deps.buildMessageNode` for each agent message (`:49-58`). `reuseUnchangedSubtree` (`service.ts:387-394`) only restores object identity after the full build. | **V** |
| 336 | Where the guarantee lives | Comment `execution-tree-builder.service.ts:291-309`. Regression test `execution-tree-builder.service.spec.ts:971-996`: "agrees with a full rebuild when a resumed tab swaps in a fresh StreamingState under the same cache key". | **V** |

## 2. Batch 1 - streaming markdown and sidebar transitions

### 1a. Streaming markdown: sanitize each completed block once and append it

**Files**

- MODIFY `libs/frontend/markdown/src/lib/streaming-markdown-renderer.ts`
- MODIFY `libs/frontend/markdown/src/lib/streaming-markdown-renderer.spec.ts`
- MODIFY `libs/frontend/markdown/src/index.ts`: export the new block type (`:4` already exports the class)
- MODIFY `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts` (template `:216-233`, fields `:491-493`, `publishNow` `:535-542`, `publishStreaming` `:544-549`)
- CREATE `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.streaming-dom.spec.ts`. Alternatively, extend `execution-node.render-throttle.spec.ts`.

**Design**

1. `StreamingMarkdownRenderer.render(source)` returns a structured result
   instead of an HTML string:
   `{ blocks: readonly StreamingMarkdownBlock[]; tail: string }`, where
   `StreamingMarkdownBlock = { readonly id: number; readonly html: string }`.
   - The completed-region detection stays as it is: `completedBlockEnd`
     (`:32-51`) and `paragraphBoundary` (`:54-57`).
   - When `completedEnd` advances, the newly completed slice is parsed once by
     `marked` (as today at `:15`). It is then sanitized once, on its own, with
     `sanitizeFullMarkdownHtml(chunkHtml)`, and pushed as one new block.
   - `blocks` is append-only. Existing entries keep object identity. The array
     reference changes only when a block is added, so a frame where only the
     tail grows returns the same `blocks` reference.
   - `id` comes from a counter on the instance that never resets, including in
     `reset()`. After a non-prefix change (`:12`), the new blocks get new ids,
     so Angular's `@for` tears the old DOM down.
   - `tail` is the raw, unparsed text after the last boundary. It is never
     HTML. The renderer stops calling `escapeHtml` and stops building
     `<p>…<br></p>`, so `escapeHtml` (`:59-61`) is deleted.
2. `ExecutionNodeComponent` keeps two signals instead of `_streamingHtml`:
   - `_streamingBlocks = signal<readonly StreamingMarkdownBlock[]>([])`. It uses
     default `Object.is` equality, so an unchanged array does not reach the
     view.
   - `_streamingTail = signal('')`.

   `publishNow` clears both. `publishStreaming` sets both from `render()`. The
   template replaces `:226-227` with this:

   ```html
   <div class="ptah-markdown-root" style="contain: layout paint; isolation: isolate; overflow-x: auto;">
     @for (block of streamingBlocks(); track block.id) {
       <div class="contents" [innerHTML]="block.html"></div>
     }
     @if (streamingTail()) { <p class="whitespace-pre-line">{{ streamingTail() }}</p> }
   </div>
   ```

   - The wrapper copies `wrapInContainmentRoot`
     (`provide-markdown-rendering.ts:223-225`) and closes gap HS2f. Use the
     exported `MARKDOWN_CONTAINMENT_ROOT_CLASS` constant (`:208`) if it is
     re-exported from the package index. Otherwise use the literal.
   - `display: contents` keeps each block's children as direct flow children,
     so `prose` spacing applies as it does today.
   - `whitespace-pre-line` reproduces today's `\n → <br>` behaviour, and the
     text is placed by interpolation (a text node), never parsed.
   - Do not use `bypassSecurityTrustHtml`, `Renderer2`, `insertAdjacentHTML` or
     `createContextualFragment`. The repo has no precedent for any of them in
     `libs/frontend` (grep of non-spec files: only
     `core/src/lib/routing/retained-view.directive.ts:35` uses `Renderer2`, for
     attributes). Angular's sanitizer stays as a second layer, as it is today.
     It runs once per new block, not once per frame.
3. Per-frame cost after the change:
   - Tail-only frame: one signal write, one text-node `data` update, zero
     Documents.
   - Block-completing frame: one `marked.parse` and one DOMPurify Document for
     the new chunk only, plus one Angular inert parse for that block. Existing
     block DOM is untouched because `@for` tracks by id and each binding value
     keeps the same string.
4. Settling is unchanged. When `isNodeStreaming()` turns false, `publishNow`
   (`:535-542`) clears the streaming signals, and the `<markdown>` branch
   renders the full message through ngx-markdown and the full DOMPurify
   pipeline. Any streaming-time fidelity difference ends at settle.

**Failure behaviour**

- If `marked.parse` or the sanitizer throws on a chunk, the renderer adds no
  block and keeps that slice in the tail (raw text). The next render retries
  from the same boundary.
- No exception leaves `render()`. The component therefore keeps showing plain
  text, never unsanitized HTML.
- The `INCREMENTAL_STREAMING_PRESENTATION_ENABLED = false` rollback still
  returns to the `<markdown>` path (`scroll-dirty.service.ts:4-7`).

**Tests**

- `libs/frontend/markdown/src/lib/streaming-markdown-renderer.spec.ts`
  - Rewrite `uses the full marked and sanitizer path when the message settles`
    (`:18-26`): the joined `blocks.map(b => b.html)` equals
    `sanitizeFullMarkdownHtml(fullMarked.parse(source))` for a single-block
    source.
  - Rewrite `never puts unsafe HTML from an open tail into the DOM` (`:48-54`):
    `blocks` is empty and `tail` equals the raw source.
  - Rewrite `keeps an unclosed fence in the open tail` (`:40-46`) to use the
    `tail` field.
  - Add `sanitizes each completed block exactly once`. Mock
    `./provide-markdown-rendering` with a counting wrapper around the real
    function. Three renders that grow only the tail add zero calls. One render
    that completes a block adds exactly one call, with only that block's HTML.
  - Add `returns the same blocks array when only the tail changes`, and check
    that earlier blocks keep their identity when a block is added.
  - Add `a payload split across a block boundary never yields an active
    attribute`. Inputs: `'<img src=x\n\nonerror=alert(1)>'`,
    `'<a href="java\n\nscript:alert(1)">x</a>\n\n'`, and
    `'<svg>\n\n<script>alert(1)</script>\n\n</svg>\n\n'`. After each completed
    render, no `block.html` matches `/onerror|javascript:|<script/i`.
  - Add `a non-prefix source resets with fresh ids`.
- `execution-node.streaming-dom.spec.ts` (new)
  - Across two frames that add a second block, the first block's DOM element
    is the same node (`toBe`), which proves there is no replacement.
  - A tail-only frame changes only the tail text node.
  - The tail `<img src=x onerror=alert(1)>` produces no `img` element.
  - Settling switches to `<markdown>`.
- Regression only, unchanged: `chat-transcript.display.spec.ts`,
  `execution-node.ptah-ui.spec.ts`, `execution-node.render-throttle.spec.ts`.

**Nx projects to verify:** `markdown`, `chat`.

**Risks**

- `display: contents` wrappers could change a `prose > :first-child` margin
  rule. Check visually once, with a short streaming message.
- Angular's sanitizer strips `style` attributes and SVG from streaming blocks.
  That is today's behaviour, so nothing regresses.
- A blank line inside a raw HTML block of CommonMark types 1-5 (`<pre>`,
  comment, `<script>`) is split into two blocks while the message streams.
  This affects fidelity only, ends at settle, and does not affect security
  (see section 3).

### 1b. Sidebar transitions

**Files**

- MODIFY `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
  - `:101`: `[class.transition-all]` → `[class.transition-[width]]`. The aside
    only animates its `[style.width.px]` (`:103`). Keep `duration-300` and the
    `transition-none` swap at `:102`. Update the comment in
    `app-shell.component.ts:266-270` so it names `transition-[width]`.
  - `:254`: `transition-all` → `transition-colors`. Only `hover:bg-surface-2`
    changes on hover. The `sidebar-item-*` box-shadows at
    `styles.css:2203-2213` currently animate under `transition-all`. To keep
    that, use `transition-[color,background-color,box-shadow]`. Pick one and
    record it in batches.md.
  - `:487`: `transition-all` → `transition-colors`.
- MODIFY `apps/ptah-extension-webview/src/styles.css:2221-2223`: narrow the
  hover dependency to the scroll element and keep the visual intent. Replace
  the rule with:

  ```css
  .sidebar-scroll:not(:hover) { scrollbar-color: transparent transparent; }
  ```

  The pointer is over `.sidebar-scroll` for almost all of the aside, which
  makes the visible difference small. If the product wants "reveal on any
  aside hover" kept exactly, leave this selector as it is. The transition fix
  above is the part that removes the trace's transitions. See Decision D4.
- Do not add a descendant reset (`.sidebar-scroll > * { scrollbar-color: … }`).
  `styles.css:638-643` already gives every element its own value (CSS2), so it
  would be dead CSS.

**Tests:** add to
`libs/frontend/chat/src/lib/components/templates/app-shell.organization.spec.ts`
the test `sidebar rows and footer do not use transition-all`. It mirrors
`effort-selector.component.spec.ts:217-237`: query `aside .sidebar-scroll
button` and the footer button, then assert `transition-colors` and no
`transition-all`. The aside asserts `transition-[width]`.

**Nx projects to verify:** `chat`. `styles.css` lives in the webview app. Do
not build it. The CSS is checked visually or in the after-trace only.

**Risks:** If the box-shadow change is not listed, the active-row
inset-shadow animation is lost. That is cosmetic.

## 3. Security argument (Batch 1a)

Invariant: **every string that reaches an HTML parser connected to the live
DOM is the output of `sanitizeFullMarkdownHtml` for exactly that string, or is
inserted as text.**

1. **The sanitize unit is the insertion unit.** Each block's `html` is
   produced by one `sanitizeFullMarkdownHtml(chunkHtml)` call. It is then given
   to its own `<div [innerHTML]>`, so it is parsed alone, into its own element.
   - Sanitized strings are never concatenated, and no fragment is parsed again
     next to another one.
   - DOMPurify's guarantee applies to "this string, parsed alone in a body
     context". That is exactly how each block is parsed.
2. **Splitting cannot change a fragment's meaning.** A fragment cannot leave
   its host element.
   - A `<div>` that is open in block N is closed by the parser inside block N's
     host. Block N+1 is parsed in a different element and cannot be adopted
     into it.
   - An attribute or URL split across the boundary (`<img src=x` / `onerror=`)
     is never parsed as one token. Each half is sanitized and parsed
     separately.
   - Therefore the correctness of the split heuristic (`completedBlockEnd`,
     which cuts on raw `\n\n` and fences rather than on marked lexer tokens)
     matters for fidelity only, not for safety.
   - Splitting at marked lexer top-level token boundaries would improve
     streaming fidelity for HTML blocks of types 1-5. It is deliberately not
     needed for the safety argument (Decision D2).
3. **The tail is text.** The tail is placed with `{{ }}` interpolation, which
   creates a text node. No parser sees it, so it needs no sanitizer. Today the
   tail goes through `escapeHtml` and then DOMPurify (`:19`). The new path
   removes a parser instead of adding one.
4. **Defence in depth is kept.** Angular's DomSanitizer still runs on every
   `[innerHTML]` value, because the design does not bypass it. The containment
   root (Layer 1, `provide-markdown-rendering.ts:210-225`) is added to the
   streaming path, where it is missing today (HS2f).
5. **DOMPurify options.**
   - `RETURN_DOM_FRAGMENT` does **not** avoid the Document. The string path
     still calls `_initDocument` (`purify.es.mjs:1448-1470`). The fragment is
     only re-homed from that document's body (`:2625-2630`).
   - `IN_PLACE` does avoid `_initDocument` (`:2463-2512`). But it requires a
     caller-built element root that is in `ALLOWED_TAGS` (`:2475-2483`; a
     DocumentFragment root throws). It also moves parsing into our code, for
     example a reused `<template>`.
   - Because per-frame sanitization drops to per-block, the remaining Document
     rate is about one per completed paragraph. `IN_PLACE` is therefore
     rejected as extra attack surface for a small gain (Decision D1).

## 4. Batch 2 - execution-tree reuse

**Files**

- MODIFY `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts`
- MODIFY `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.spec.ts`
- No change to `batched-update.service.ts:190`. The copy stays (Decision D3).
- Only if the memo cannot be done in the service's deps closure: MODIFY
  `libs/frontend/chat-execution-tree/src/lib/builders/agent-node.fn.ts`. Its
  `builder-deps.ts:6-7` says the recursion closures are wired by the service,
  so this should not be needed.

### Design

1. **The reuse gate uses container identity instead of object identity.**
   - Replace `TreeCacheEntry.indexState: StreamingState | null` (`:109`) with
     `indexIdentity: StreamingStateIdentity | null`, where
     `StreamingStateIdentity = { events; eventsByMessage; messageRevisions }`
     holds the three Map references.
   - Add `sameIdentity(entry, state)`. It is true when all three references
     are `===`, including `messageRevisions` being `undefined` on both sides.
   - Use it at `:310` (rename `sameStateObject` → `sameStateIdentity`) and at
     `resolveIndexes` `:518`. Store it at `:425` and null it at `:779`.
   - Rewrite the comment at `:291-309` to state the new rule.
   - Why it is correct: the flush copy `{ ...state }` (`batched-update:190`,
     `chat-lifecycle:196`) is shallow, so it shares all three Maps (**V**:
     `createEmptyStreamingState`, `chat-types.ts:168-184`, creates them as
     fresh Maps). Every digest input (`messageRevisions.get`,
     `eventsByMessage` bucket length; `:585-593`) is read from these exact
     containers. Two states with the same containers therefore have comparable
     digests. A replaced state always has different containers.
2. **Rebuild only the changed agent's subtree path.**
   - Extend `computeRootDigests` (`:581-597`) so the same pass also produces
     `digestByToolCall: Map<toolCallId, number>`. For each message, walk its
     chain of `message_start.parentToolUseId` → `toolStartByCallId` → owning
     message (indexes `streaming-indexes.ts:69,89,113`). Fold the message's
     revision and bucket length into every ancestor tool id. The chain is
     bounded by `MAX_DEPTH`.
   - Wrap the service's `buildAgentNode` deps closure with a memo kept in
     `TreeCacheEntry` (`agentNodeByToolCall: Map<string, { key: number; node: ExecutionNode }>`).
     The key is `mix(digestByToolCall(toolCallId), state.structuralRevision,
     summaryLength(agentId), blockCount(agentId),
     backgroundAgentStore.revision(), depth)`.
   - `structuralRevision` (`chat-types.ts:151`; read by `indexVersionOf`
     `:814-818`) changes on every non-delta write. That covers new agent or
     hook starts, tool results and anything else that can change the
     agent-id resolution in `agent-node.fn.ts:59-79`.
   - **A:** `structuralRevision` bumps on every write except text and token
     deltas. The implementer confirms this at its writers in `chat-types.ts`
     (grep `structuralRevision`).
   - When `agentStart.agentId` is empty (the hook-match path), the memo is
     bypassed and the node is always rebuilt. This is conservative.
   - The memo is discarded whenever `sameStateIdentity` is false.
   - Result: a token delta in agent A's message changes `digestByToolCall` for
     A's tool id and its ancestors only. The root is rebuilt shallowly, A is
     rebuilt, and sibling agent B returns its memoized node without calling
     `buildMessageNode` for B's messages.
3. **Remove summary and blocks from the global epoch.**
   - Delete `:552-564`. Each agent's summary length and block count are now
     folded where they are observed:
     - In the agent memo key, as above.
     - Into the digest of the root that owns the agent. The chain is agentId →
       its `agent_start` (`agentStartsByParent` / `toolStartByCallId`) → tool
       id → message → `rootMessageIdByMessageId`.
   - Summaries whose agentId cannot be traced to a root stay in the global
     epoch, which keeps today's behaviour for them.
   - The comment at `:526-550` is updated to match.

### Failure behaviour

All three changes only narrow when reuse is allowed. Any unattributed input
falls back to a rebuild. When identity, the digest or the key is missing or
`undefined`, the code rebuilds. It never reuses.

### TASK_2026_336 argument

- 336 protects one case. `applyResumingSession` installs a fresh
  `createEmptyStreamingState()` under the same `tab-${tabId}` key. Its counters
  restart, so the content folds collide with the cached entry (spec
  `:978-989`).
- A fresh state has fresh `events`, `eventsByMessage` and `messageRevisions`
  Maps (`chat-types.ts:170,179,181`). The identity check therefore fails and
  nothing is reused, which is the same outcome as today.
- This still holds when the fresh state is delivered through the flush copy,
  because the copy shares the fresh state's Maps, not the old ones.
- Other replacement producers:
  - `message-finalization.service.ts:311` builds `events: new Map(state.events)`,
    so its identity is new.
  - Compaction's `replacementState` is `createEmptyStreamingState()` (**V**:
    `accumulator-core.service.ts:574,579`). Fork has not been checked (**A**:
    confirm that it builds new Maps).
  - No production code reassigns or clears these Maps in place, except a lazy
    `messageRevisions` creation on an untracked literal at
    `chat-types.ts:301-302`, which only produces a new identity (**V**: grep
    for `.clear(` / reassignment).
- Residual risk: a future writer that `clear()`s these Maps and restarts the
  counters on the same object would defeat both today's check and the new
  one. Note this in the rewritten `:291-309` comment.

### Tests (`libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.spec.ts`)

- **336 regression (keep unchanged):** `agrees with a full rebuild when a
  resumed tab swaps in a fresh StreamingState under the same cache key`
  (`:971-996`).
- Add `never reuses a fresh StreamingState delivered as a flush copy`. This is
  the same scenario with `builder.buildTree({ ...state }, key)`.
- Add `reuses the cached tree when the same state arrives as a new shallow
  copy`. Two `{ ...state }` copies with no write in between give `toBe`
  (identical) roots. This proves the cache now hits.
- **Acceptance test:** `one sub-agent token delta does not rebuild sibling
  sub-agent subtrees`.
  - Setup: one root, two Task tools, agents A and B.
  - Feed a text delta to A's message.
  - Assert that B's agent node is `toBe` the previous build's node.
  - Assert, with a spy on `buildMessageNode` (or on the deps closure), that
    B's message id was not built.
  - Assert that A's node was rebuilt and shows the new text.
- Add `an agent summary chunk invalidates only the owning root`.
  `agentSummaryAccumulators` grows for A, and the other roots stay `toBe`.
- Add `an unattributed agent summary still invalidates (global fallback)`.

**Nx project to verify:** `chat-streaming`.

**Risks:** The memo key could miss an input that `buildAgentNode` reads. To
mitigate, keep the existing oracle `expectEquivalent()`. It compares each
build with a full rebuild (spec `:960,975,994`). Add the new scenarios under
that oracle.

## 5. Implementer verification rules (STRICT, from CLAUDE.md)

- Test only the changed projects: `npx nx test <project>`,
  `npx nx typecheck <project>`, `npx nx lint <project>`, or Jest on the
  changed spec files with
  `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
  Projects here: `markdown`, `chat`, `chat-streaming`.
- Nx with `--parallel=1`. Jest with `--maxWorkers=2`.
- One heavy check at a time, across all lanes.
- No workspace-wide runs, and no `nx run-many` across projects you did not
  change.
- No `build`, `serve`, `dev`, `e2e` or `package` targets.
- Filter the output (`| tail`, `grep`) instead of running the command again.

## Decisions

| ID | Decision | Options | Evidence | Reversible |
|---|---|---|---|---|
| D1 | Sanitize each completed block with the existing string API. Do not use `IN_PLACE` | (a) string API per block; (b) `IN_PLACE` + reused `<template>`; (c) `RETURN_DOM_FRAGMENT` | (c) still creates a Document (`purify.es.mjs:1448-1470,2625`). (b) needs a hand-built allowed root (`:2475-2483`) and our own parser. (a) reduces Documents from one per frame per node to one per completed block | Yes |
| D2 | Keep the regex boundary (`completedBlockEnd`). The safety argument does not depend on it | (a) keep it; (b) re-lex the open region with `marked.lexer` each frame | Safety holds because each block is parsed alone (section 3). (b) costs O(open block) lexing per frame, which can be large for a long fence | Yes |
| D3 | Keep the flush `{ ...state }` and gate reuse on container identity | (a) remove the copy; (b) container identity; (c) a new `instanceId` field | (a) Downstream signals rely on a new reference to propagate; this was not audited, and the risk is a frozen UI. (c) needs a type change and is still copied by any spread-built replacement. (b) has the same failure mode as (c), needs no type change, and is the exact precondition for comparable digests | Yes |
| D4 | Sidebar: narrow `transition-all` (required); narrow the hover selector (optional) | (a) transitions only; (b) also `.sidebar-scroll:not(:hover)`; (c) descendant `scrollbar-color` reset | (c) is dead CSS because of `styles.css:638-643`. (a) mirrors `effort-selector.component.ts:124-134` | Yes |
| D5 | Use Angular `[innerHTML]` per block. No bypass, no Renderer2 | (a) `@for` + `[innerHTML]`; (b) a directive using `insertAdjacentHTML` | No `bypassSecurityTrust*` or `insertAdjacentHTML` precedent in `libs/frontend`. (a) keeps two sanitizers and stays idiomatic | Yes |

## Clarifications Needed

None block the plan. Each one is resolved by a default and recorded in
batches.md.

1. Session-row transition (1b `:254`):
   - `transition-[color,background-color,box-shadow]` (Recommended, keeps the
     active-row shadow animation)
   - `transition-colors`
2. Sidebar scrollbar reveal (D4):
   - Keep `aside:not(:hover) .sidebar-scroll` (Recommended, no visible change)
   - Switch to `.sidebar-scroll:not(:hover)`

## What to look for in the after-trace

**Batch 1a**

- The document count stays flat while streaming. Target: growth of 0.8/s
  drops to about the paragraph-completion rate, and below 0.1/s on
  code-heavy output.
- No `ParseHTML` per frame for streaming nodes.
- Per-frame `UpdateLayoutTree` elements for a streaming node drop to the tail
  `<p>` plus new blocks.
- Renderer private memory grows more slowly than JS heap stays flat.
- An allocation-sampling profile shows the `sanitize` / `_initDocument` share
  dropping by at least an order of magnitude.

**Batch 1b**

- Zero `scrollbar-color` transitions on sidebar buttons, against the
  36 + 24 + 9 + 5 in the baseline.
- Hovering the sidebar produces one small recalculation (the scroll element)
  instead of a subtree restyle.

**Batch 2**

- Scripting time in `buildTree` / `buildStreamingIndexes` per frame drops.
- With N sub-agents streaming, `buildMessageNode` self time scales with the
  changed agents, not with all agents.
- Fewer short-lived `ExecutionNode` objects in allocation sampling.
- No change in the 336 resume scenario: a resumed tab shows the new session's
  content.


---

# Part B1

# Plan part B1 - TASK_2026_628_5ab5 (hot spots 3 and 4)

Scope: renderer memory/CPU churn while many chat sessions stream. Hot spot 3 (AGENT_SUMMARY_CHUNK)
and hot spot 4 (CLI agent output, AGENT_MONITOR_OUTPUT). Worktree: `D:\projects\ptah-wt-628`.
All paths below are relative to that worktree. "Verified" = opened at the cited line. "Assumption" =
not opened within this architect's 20-call budget; the implementer must run the stated check first.

## 1. Verified table

| # | Claim (from brief) | Status | Current location |
| --- | --- | --- | --- |
| 1 | AGENT_SUMMARY_CHUNK concatenates the summary, copies the blocks array and calls `setStreamingState({ ...state })` per chunk | Confirmed (line range corrected to 185-197) | `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts:185-197` - concat :188-190, block copy `[...currentBlocks, ...contentBlocks]` :193, `setStreamingState(tab.id, { ...state })` :196. Background-workspace fallback lookup :164-176 |
| 2 | BatchedUpdateService exists with a visibility gate | Confirmed | `libs/frontend/chat-streaming/src/lib/batched-update.service.ts` - `scheduleUpdate(tabId, state)` :127-140, rAF frame :146-152, `canFlush` (surface active + document visible + visible/active tab) :174-180, flush `setStreamingState(tabId, { ...state })` :190, `hasPendingUpdates` :296, `clearPendingUpdates` :302, `flushSync(originTabId)` :269 |
| 3 | No frontend batching for AGENT_MONITOR_OUTPUT | Confirmed | `libs/frontend/chat/src/lib/services/agent-monitor-message-handler.service.ts:35-36` calls `store.onAgentOutput` synchronously per message |
| 4 | Store clones agent + copies the list per delta | Confirmed | `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1276-1364` - linear find :1278-1285, clone :1288, segment merge copies :1330-1341, `capSegments` :1347, streamEvents in-place push :1353-1357, list copy :1360-1362 |
| 5 | `_byId` recomputed on each change | Confirmed | `agent-monitor.store.ts:664-670` (computed over `_agents`, O(n) Map rebuild) |
| 6 | `agents` copies the list | Confirmed | `agent-monitor.store.ts:794` `computed(() => [...this._agents()])`; `agentsById` :800 |
| 7 | `storeAgentIds` recomputes | NOT verified | Grep over `libs/frontend` (head_limit 15) did not surface it. Assumption: it is a computed in `agent-monitor.store.ts` or a consumer; implementer locates it with `ptah_code_search_symbols "storeAgentIds"` before Batch 4 |
| 8 | `capBuffer` allocates a new ~50 KB string per delta once past the cap | Confirmed | `libs/frontend/chat-streaming/src/lib/agent-output-retention.ts:64-76` - regex exec :65, `body.slice(cutAt)` + notice concat :75 runs on every call where `body.length > max` |
| 9 | Agent card re-parses all stdout/stderr | Confirmed | `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:152-155` (`parsedOutput` = `parseAgentOutput(stdout)`), :160-164 (`parsedStderr`); `scrollTrigger` :167-174 |
| 10 | `parseAgentOutput` is a full split + line scan | Confirmed | `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.utils.ts:45-...` (`stdout.split('\n')` :46, stateful text merge :48-55, multi-line `[stderr]` run :68-80) |
| 11 | `keyedSegments` keys by content -> views re-created | Confirmed (mechanism refined) | `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:332-346`. Last segment keyed `tail:<type>` :337-339; others keyed `segmentContentKey(segment)#occurrence` :341-344. When a new segment is appended the former tail changes key from `tail:*` to a content key, so its view (and its `<markdown>`) is destroyed and re-created. A front-truncation changes the first segment's content and therefore its key |
| 12 | Text segments re-run `<markdown>` unthrottled | Confirmed | `agent-card-output.component.ts:292-299` - `<markdown [data]="segment.content \| surfaceMarkdown: surfaceActive()">` :295-297. `surfaceMarkdown` gates only on surface activity (same pipe used by `agent-summary.component.ts:79,108`) |
| 13 | `assembleTree` O(messages x blocks) | Confirmed | `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:520-553`; per message `buildMessageChildren` :559-619 iterates ALL `textAccumulators` :572 and ALL `thinkingAccumulators` :587 with `startsWith`, and `toolStarts.filter` :602 -> O(messages x (text+thinking+tools)) |
| 14 | `JSON.parse` per tool input on every rebuild | Confirmed | `agent-monitor-tree-builder.service.ts:636-658` - `JSON.parse(inputString)` :642 for every tool with a result, every assembly |

## 2. Batch 3 (hot spot 3 - AGENT_SUMMARY_CHUNK)

### Dependency on Batch 2 (assumed landed first)

Batch 2 (other architect) removes the `{ ...state }` copy in `BatchedUpdateService.flushPendingUpdates`
(`batched-update.service.ts:190`) and removes summary length / block count from `computeGlobalEpoch`.
Consequences for Batch 3:

- After Batch 2, the summary Map mutation (`agentSummaryAccumulators.set`) is no longer made visible by
  a new state reference or by the epoch. Batch 3 therefore MUST use whatever invalidation contract
  Batch 2 introduces for in-place streaming-state mutations (a revision/epoch bump or a per-agent
  signal). Batch 3 does not invent its own; if Batch 2 ships none, Batch 3 is blocked (see
  Clarifications Needed Q1).
- Batch 3 must land after Batch 2 (same `StreamingState` invalidation semantics). Order: Batch 2 -> Batch 3.

### Files

- MODIFY `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts` (summary-chunk handler, :185-197).
- MODIFY (only if the check below fails) `libs/frontend/chat-streaming/src/lib/batched-update.service.ts`
  - add a read accessor for the pending/deferred state of a tab.
- MODIFY/CREATE spec: `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.spec.ts`
  (Assumption: exists colocated; create if absent), and if the accessor is added,
  `libs/frontend/chat-streaming/src/lib/batched-update.service.spec.ts`.

### Design

1. Inject `BatchedUpdateService` (from `@ptah-extension/chat-streaming`; the chat lib already imports
   that package - `agent-monitor-message-handler.service.ts:16` - so dependency direction is unchanged).
   Assumption: `BatchedUpdateService` is exported from the chat-streaming barrel; check
   `libs/frontend/chat-streaming/src/index.ts`.
2. Per chunk, per target tab:
   - Resolve the state to mutate as: the state already pending/deferred in `BatchedUpdateService` for
     `tab.id` if any, else `tab.streamingState`. Reason: `scheduleUpdate` stores a whole state object
     (:136 / :130); scheduling the stale `tab.streamingState` while a newer state is pending would
     overwrite the newer one and lose streaming events. Assumption to resolve: whether the streaming
     path mutates one shared `StreamingState` object (then `tab.streamingState === pending` and no
     accessor is needed) or creates new objects per event (then add `peekPending(tabId): StreamingState
     | undefined` returning `pendingTabUpdates.get(tabId) ?? deferredTabUpdates.get(tabId)`).
   - Summary: `agentSummaryAccumulators.set(agentId, current + summaryDelta)` (string concat stays; V8
     ropes make it O(delta) until read).
   - Blocks: append in place - `let arr = map.get(agentId); if (!arr) map.set(agentId, arr = []);
     arr.push(...contentBlocks)` - no `[...currentBlocks, ...contentBlocks]` copy per chunk. Assumption
     to check: no consumer relies on `agentContentBlocksMap.get(agentId)` array identity for change
     detection (search consumers of `agentContentBlocksMap` with `ptah_lsp_references`). If one does,
     copy the array ONCE per flush in the consumer's invalidation path, not per chunk.
   - Bump Batch 2's invalidation contract for the tab, then `batchedUpdate.scheduleUpdate(tab.id, state)`.
     Never call `tabManager.setStreamingState` directly from this handler.
3. Background workspace tabs (:171-175): `scheduleUpdate` defers them through `canFlush` (they are not
   visible), and the eventual flush goes through the workspace-aware `setStreamingState`. This is the
   intended visibility gate; no special case.

### Failure behaviour

- No tab with streamingState: unchanged (warn + return, :177-183).
- If the tab closes while a summary update is pending: BatchedUpdateService already owns that via
  `clearPendingUpdates` (:302) - no new path.
- If the accessor returns a state for a tab whose `streamingState` was cleared (stream finished), the
  handler must drop the chunk (same as today's `if (!state) continue`).

### Tests (behaviour)

- N summary chunks within one frame -> exactly one `setStreamingState` call for the tab after the rAF
  flush (fake rAF), summary equals concatenation, blocks equal all appended blocks in order.
- Hidden document / non-visible tab -> zero `setStreamingState` calls until the tab becomes visible.
- Chunk arriving while a streaming state update is pending -> the pending state is not overwritten
  (events from the streaming path survive).
- Regression: block array is not reallocated per chunk (same array reference before/after a chunk).

### Nx projects

`chat` (and `chat-streaming` only if the accessor is added). Assumption: project names are the folder
names; confirm in each `project.json`.

### Risks

- Stale-state overwrite (above) is the main correctness risk; covered by the pending-state rule and test.
- Summary visible latency rises to one frame (16 ms) on visible tabs - intended.

## 2. Batch 4 (hot spot 4 - AGENT_MONITOR_OUTPUT)

Public contract to keep stable (TASK_2026_629 reads it): `AgentMonitorStore.agents`
(`agent-monitor.store.ts:794`, a new mutable `MonitoredAgent[]` copy), `agentsById` (:800), and every
other public signal name/shape. `MonitoredAgent` field names and types stay unchanged
(`stdout`, `stderr`, `segments`, `streamEvents`, `streamRevision`, `usageTotals`, `cacheReported`).

### 4a. Frontend frame coalescing of output deltas (store-owned)

- Files: MODIFY `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`. The handler
  (`agent-monitor-message-handler.service.ts:36`) stays a one-line delegate - no change.
- Design:
  - `onAgentOutput(delta)` no longer writes `_agents`. It merges the delta into a private
    `pendingOutput: Map<agentId, PendingOutput>` (`stdout: string`, `stderr: string`,
    `segments: CliOutputSegment[]` (push), `streamEvents: [...]` (push)) and schedules ONE
    `requestAnimationFrame` for the whole store if none is pending.
  - The frame callback applies all pending agents in a single `_agents.update`: one list copy per frame
    (not per delta), one clone per changed agent, unchanged agents keep their object identity. The
    per-agent merge logic (usage folding :1302-1319, text/thinking tail merge :1325-1341,
    `capSegments` :1347, in-place streamEvents + `streamRevision` bump :1349-1357) is extracted into a
    private pure `applyOutput(agent, pending): MonitoredAgent` and run unchanged - so behaviour per
    delta is preserved, only the cadence changes. Segment merge for multiple coalesced deltas: merge
    incoming segments across deltas first (same text/thinking adjacency rule), then apply once.
  - Lookup through `this._byId()` instead of the linear scan (:1278-1285) for the index-free path;
    keep a `Map<agentId, index>` built once per flush.
  - Ordering: `onAgentExited` (:1366), `onAgentExpired`, and any method that removes/replaces an agent
    MUST first call `flushPendingOutput(agentId)` synchronously so output never lands after exit or on a
    removed agent. Pending output for an unknown agent is dropped (same as `foundIndex === -1` today).
  - Hidden document: rAF does not fire; pending strings are bounded by the 4c cap rule applied to the
    pending buffers too (trim pending stdout/stderr when > 2x cap), so a hidden window cannot grow
    unbounded. On visibility return, one frame applies everything.
  - Release path: cancel the rAF in the store's `DestroyRef.onDestroy` (Assumption: the store is
    `providedIn: 'root'`; inject `DestroyRef` as `BatchedUpdateService` does - `batched-update.service.ts`
    imports `DestroyRef`).
- Rejected: batching in the message handler (the store already owns ordering with exit/permission
  events; splitting it across two classes creates the out-of-order risk above). Rejected: reusing
  `BatchedUpdateService` (keyed by tab + `StreamingState`, wrong shape).
- `_byId` (:664) and `agents` (:794) stay computed and keep their shapes; they now recompute once per
  frame instead of once per delta per agent. `storeAgentIds` (unverified, row 7): if it is derived from
  `_agents`, make it equality-stable (`computed(..., { equal: sameIdsInOrder })`) so membership-only
  consumers do not re-run on output-only frames. Same for any membership-only computed found next to it.

### 4b. Amortized buffer cap

- Files: MODIFY `libs/frontend/chat-streaming/src/lib/agent-output-retention.ts` (`capBuffer` :64-76).
- Design: hysteresis. `capBuffer(str, max)` returns `str` unchanged while `body.length <= 2 * max`;
  once over, trims to `max` (same newline-aligned cut, same cumulative truncation notice). Allocation
  of a ~max-sized string now happens once per ~max characters of new output instead of per delta.
  Cheap pre-check: if `str.length <= 2 * max` return before running the notice regex.
- Effect: retained buffer oscillates between max and 2x max (50-100 KB per stream per agent). Callers
  unchanged.
- Rejected: ring buffer / chunk array (changes `MonitoredAgent.stdout: string`, a public shape).

### 4c. Incremental stdout/stderr parsing in the agent card

- Files: MODIFY `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.utils.ts`
  (add incremental parser next to `parseAgentOutput` :45; `parseAgentOutput` stays as the reference
  implementation and fallback), MODIFY `agent-card.component.ts` (`parsedOutput` :152-155,
  `parsedStderr` :160-164).
- Design: a per-card parser object (owned by the component instance, no timers):
  - State: `source` (last parsed string), `stableEnd` (offset of the start of the line that opens the
    last emitted segment - everything before it is final, because merges only extend the last text
    segment or the trailing `[stderr]` run), `stableSegments` (segments fully before `stableEnd`).
  - Update(next): if `next.startsWith(source.slice(0, stableEnd))` is guaranteed by append-only growth
    - check cheaply: `next.length >= source.length` and the head truncation notice count unchanged
    (the notice is at offset 0, `agent-output-retention.ts:64-67`) - parse only `next.slice(stableEnd)`
    with the existing line logic and return `stableSegments.concat(tail)`; otherwise (front trim
    happened, now rare after 4b) do a full `parseAgentOutput(next)` and rebuild state.
  - Same for stderr with `parseStderr`.
- Must produce output deep-equal to `parseAgentOutput(full)` for any chunking.

### 4d. Stable segment keys + throttled tail markdown

- Files: MODIFY `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts`
  (`keyedSegments` :332-346, text case :292-299).
- Keys: replace the content/tail scheme with index-based keys `${index}:${segment.type}`. Append-only
  growth (the normal case; parsed and structured segments only extend the tail or append) keeps every
  existing view; the former tail no longer changes key when a new segment arrives. A type change at
  an index or a front trim re-creates only the affected views - acceptable and rare after 4b.
  `segmentContentKey` is deleted if unused elsewhere (check with `ptah_lsp_references`).
- Throttled markdown: only the LAST text segment's content changes while streaming. Feed the tail text
  segment's markdown from a component-level `tailMarkdown` signal updated at most once per 150 ms
  (single `setTimeout` per component instance, armed only while tail content changes, cleared in
  `DestroyRef.onDestroy`); the latest content is always applied on the trailing edge, and immediately
  when the segment stops being the tail. Non-tail segments bind their content directly (it no longer
  changes, and stable keys mean no re-render).
- Rejected: monotonic ids added to `RenderSegment` (changes a shared chat-ui type and both producers;
  index keys give the same stability for append-only data).

### 4e. Tree builder: indexed assembly + JSON.parse cache

- Files: MODIFY `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts`
  (`assembleTree` :520-553, `buildMessageChildren` :559-619, `buildToolNode` :625-658).
- Design:
  - At the start of `assembleTree`, group once: `textByMessage: Map<messageId, [blockIndex, text][]>`
    (parse the `-block-` suffix once), `thinkingByMessage`, `toolsByMessage: Map<messageId, ToolStartEvent[]>`.
    `buildMessageChildren` and recursive agent children read the groups -> O(total blocks) per assembly.
    Emitted nodes (ids, startTime ordering, sort :618) identical.
  - Private `toolInputCache: Map<toolCallId, { raw: string; parsed: Record<string, unknown> | undefined }>`:
    reuse `parsed` when `raw === inputString`; else parse and replace. Error branch (:646-657) unchanged
    and NOT cached as success (cache the fallback result keyed on the same raw string is fine since the
    input is final once a result exists). Bound the cache: clear entries for tool ids no longer present
    in `acc.toolStarts` at the end of each assembly (Assumption: the service is root-scoped and shared
    across agents - check its `@Injectable` and callers; if per-agent, scope the cache per agent id).
- Assumption: `assembleTree` runs per `streamRevision` change of an agent; after 4a it runs at most once
  per frame per changed agent. Check the caller with `ptah_lsp_references` on the public build method.

### Batch 4 failure behaviour (summary)

- Delta for unknown agent: dropped at flush (as today).
- Exit/expire before frame: pending output flushed synchronously first.
- Parser state mismatch: full reparse fallback (correctness over speed).
- JSON parse failure: existing fallback (:646-657).
- Store destroyed with frame pending: rAF cancelled, pending map cleared.

### Batch 4 tests (spec paths - Assumption: colocated `.spec.ts`; create if absent)

- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts`: N deltas in one frame -> one
  `_agents` write (observe `agents()` change count), final stdout/segments/usage/streamRevision equal
  to applying deltas one-by-one; exit after pending delta -> output applied before completion fields;
  unchanged agents keep object identity; hidden-document pending buffer is capped.
- `libs/frontend/chat-streaming/src/lib/agent-output-retention.spec.ts`: no new string while
  `body <= 2*max` (returns same reference); trims to `<= max` + notice when over; cumulative notice
  count still correct across repeated trims.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.utils.spec.ts`: incremental
  parser deep-equals `parseAgentOutput` across random chunk splits, including splits inside a line,
  inside a `[stderr]` run, around headings, and across a front-truncation.
- `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.spec.ts`: appending a
  segment does not re-create earlier segment DOM nodes (same element reference); tail markdown updates
  at most once per 150 ms with fake timers and shows final content on the trailing edge.
- `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.spec.ts`: identical tree
  output to the current implementation for a fixture; `JSON.parse` called once per tool across two
  assemblies with unchanged input (spy).

### Batch 4 Nx projects

`chat-streaming` (4a, 4b), `chat` (4c, 4e), `chat-ui` (4d). Assumption: names equal folder names.

### Batch 4 risks

- Ordering between coalesced output and exit/permission events (mitigated by synchronous flush).
- Memory ceiling doubles per buffer (4b) - bounded and intentional.
- Incremental parser divergence (mitigated by equivalence test + full-reparse fallback).
- TASK_2026_629 reading the store: public names/shapes unchanged; only update cadence changes.

## 3. Files to touch

MODIFY:
- `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts` (B3)
- `libs/frontend/chat-streaming/src/lib/batched-update.service.ts` (B3, only if accessor needed)
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` (B4a)
- `libs/frontend/chat-streaming/src/lib/agent-output-retention.ts` (B4b)
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.utils.ts` (B4c)
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts` (B4c)
- `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts` (B4d)
- `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts` (B4e)

Specs (MODIFY or CREATE): the spec paths listed under each batch.

NOT touched: `agent-monitor-message-handler.service.ts` (stays a delegate).

Parallel-safe: 4b, 4c, 4d, 4e are file-disjoint; 4a and 4b share the chat-streaming project (run their
checks sequentially). B3 depends on Batch 2.

## 4. Decisions

| Decision | Options | Chosen | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 Route summary chunks | direct setStreamingState / BatchedUpdateService / own rAF | BatchedUpdateService | visibility gate `canFlush` :174-180 already exists; per-chunk copy :196 | Yes |
| D2 Summary blocks | copy per chunk / in-place push | in-place push | copy at :193 is O(blocks) per chunk; needs consumer identity check | Yes |
| D3 Where to coalesce CLI output | handler / store / BatchedUpdateService | store | store owns exit ordering (:1366); handler is a delegate (:36) | Yes |
| D4 Cap strategy | per-delta trim / hysteresis 2x / ring buffer | hysteresis 2x | trim+slice per call :69-75; ring buffer changes public `stdout: string` | Yes |
| D5 Segment keys | content-based / index-based / monotonic id | index-based | tail key flip :337-344 re-creates views | Yes |
| D6 Markdown throttle | none / tail-only 150 ms / plain text while streaming | tail-only 150 ms | `<markdown>` per content change :295 | Yes |
| D7 Tree builder | memoize whole tree / group once + parse cache | group once + parse cache | scans :572, :587, :602; parse :642 | Yes |

## Clarifications Needed

1. Batch 2 invalidation contract: after Batch 2 removes `{ ...state }` and summary fields from
   `computeGlobalEpoch`, what signal tells the summary UI that `agentSummaryAccumulators` changed?
   - (Recommended) Batch 2 exposes a revision bump that in-place mutators call; Batch 3 calls it.
   - Batch 3 adds a per-agent summary revision field to `StreamingState`.
   - Keep summary length in the epoch (partially revert Batch 2 for summaries).
2. Tail markdown throttle interval:
   - (Recommended) 150 ms.
   - One frame (rAF) only - smoother, less saving.
   - Plain text while streaming, markdown when final.

## 5. After-trace checklist (what to look for)

- Summary streaming: `TabManagerService.setStreamingState` calls drop from one per AGENT_SUMMARY_CHUNK to
  at most one per frame per visible tab; zero for hidden/background tabs until shown.
- CLI agents: one `_agents` write (one `agents`/`_byId` recompute) per animation frame regardless of
  agent count; no AGENT_MONITOR_OUTPUT-driven computed runs while the window is hidden.
- Memory: allocation timeline no longer shows a ~50-100 KB string per delta from `capBuffer`; sawtooth
  between cap and 2x cap instead.
- `parseAgentOutput` self time near zero on steady streaming (only tail parsing); full parses only on
  front-trim.
- DOM: no node destroy/create for earlier output segments when a new segment appends; `<markdown>`
  render count per card <= ~7/s.
- `JSON.parse` from `agent-monitor-tree-builder.service.ts` once per tool, not per rebuild;
  `assembleTree` self time linear in block count.
- Long-task count (> 50 ms) and GC (Minor/Major GC) frequency lower with 5+ streaming sessions.

## Implementer verification rules (STRICT, CLAUDE.md)

- Test only the projects you changed: `npx nx test <project>` / `npx nx typecheck <project>` /
  `npx nx lint <project>`, or Jest on the changed spec files:
  `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
- Nx: `--parallel=1`. Jest: `--maxWorkers=2`.
- One heavy check at a time across all lanes; never start a second while one runs.
- No workspace-wide runs; never `nx run-many` across projects you did not change.
- No `build`, `serve`, `dev`, `e2e` or `package` targets unless the user asks.
- Prefer one foreground run with a long timeout; filter output (`| tail`, `grep`) instead of re-running.


---

# Part B2

# Plan part B2 — Hot spot 5 (tab/presentation copies per frame) — TASK_2026_628_5ab5

Scope: Batch 5 only. Assumes Batch 2 (separate plan) removes the `{ ...state }` copy in
`batched-update.service.ts` and fixes the tree-builder identity cache while keeping TASK_2026_336
(a replaced streaming state is never reused / mutated after replacement).

## 1. Verified table

| Claim | Confirmed / corrected (repo-relative file:line) |
| --- | --- |
| Tab + tabs-array copy per flush at tab-manager 1321-1338 | CORRECTED. Lines 1314-1331 are the doc comment; `updateTabInternal` starts at `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1332`. Real copies: tab spread + `lastActivityAt: Date.now()` at `:1354-1358`; whole-array copy at `:1371-1373`; `saveTabState()` called on every update at `:1375`. Existing skip fast-path (single key `streamingState`, same ref) at `:1346-1352`. `findIndex` runs twice (`:1335` and `:1340`). |
| `saveTabState` cost per flush | Verified debounced: `tab-manager.service.ts:2659-2667` (clearTimeout + `runOutsideAngular` + new `setTimeout` per call). Not a write per flush, but a timer churn per flush. |
| presentation store creates arrays/sets/messages ~118-131,180 | CONFIRMED, shifted +1: `libs/frontend/chat/src/lib/services/stream-presentation-store.service.ts:123` (`filterCompactionNoise` new array), `:124` (new `Set` of finalized ids), `:126` (`mergeByTime` new array), `:127` (ids array), `:180` (`buildTree(state, \`tab-${tab.id}\`)`), `:183-197` (new `ExecutionChatMessage` per tree per sync, so `sameMessage` at `:132` can never short-circuit on identity for the streaming tail). Dedup on tab identity at `:121`. |
| (new finding) store effect runs on every `tabs()` emission | `stream-presentation-store.service.ts:82` effect -> `releaseClosedTabs` `:109-114` builds a `Set` of every tab id on every streaming flush, because `_tabs` emits a new array per flush (`tab-manager.service.ts:1371`). |
| Canvas tile key `tile-…` at `chat-transcript.component.ts:416` builds twice | CORRECTED path: `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:410-419`. `STREAM_PRESENTATION_RECORDS_ENABLED` defaults to `true` (`stream-presentation-store.service.ts:24-26`); then `vm` reads `presentation()` (`chat-transcript.component.ts:504-521`) and the store builds with key `tab-${id}` for BOTH main panel and tile (each calls `presentationStore.sync(tab)` at `:708-710`; the store dedups at `:121`). The `tile-` build (`_executionTrees`, `:410`) is reached only via `streamingMessages`/`allMessages` (`:435`, `:469`), which are read only in the flag-off fallback (`:522-525`; no other non-spec reader in `libs/frontend/chat/src/lib`). So the double build is real when the flag is off, and will be real for any new tile consumer (TASK_2026_629 detail row) that calls `buildTree('tile-…')` itself. |
| `tile-` key cleanup sites | `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:793-797` (`clearForClosedTab`), `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:508`. `clearForTab` (`execution-tree-builder.service.ts:782-784`) clears only `tab-`. |
| Tool-input `JSON.parse` call sites | Execution tree: `libs/frontend/chat-execution-tree/src/lib/builders/tool-node.fn.ts:175-176` (call, guarded by `inputString && resultEvent`) and `:269-279` (`parseToolInput`, the actual `JSON.parse` at `:271`). Note the path is the `chat-execution-tree` lib, not `chat/.../organisms/chat-execution-tree`. Agent monitor: `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:640-642` (same `inputString && resultEvent` guard). Compact summary: `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts:318-320` (returns `input` on failure). |
| Nx tags | `chat-execution-tree`, `chat-ui`, `chat`, `chat-streaming`: `scope:webview, type:feature`; `chat-state`: `type:data-access`; `chat-types` (`@ptah-extension/chat-types`): `scope:webview, type:util`. `type:util` may depend only on `type:util` (`eslint.config.*` depConstraints). `chat-types` today is one file, `src/lib/chat-types.ts`, re-exported from `src/index.ts`. |

## 2. Batch 5

Nx projects changed: `chat-state`, `chat`, `chat-execution-tree`, `chat-types`.

### 5a. TabManager — `updateTabInternal` only (`chat-state`)

Keep every change inside `updateTabInternal` (`tab-manager.service.ts:1332-1381`); the
`fix/session-budget-handoff` branch edits this file elsewhere, so no signature, field or
other-method change.

Design:
1. Generalise the no-op fast path (`:1346-1352`): skip (return `tabs`, no copy, no
   `saveTabState`) when EVERY key in `updates` is `Object.is`-equal to the existing tab's value.
   Iterate with `for…in` instead of `Object.keys(updates).length` (no array allocation). This
   covers repeated `status: 'streaming'` / same `streamingState` writes. `lastActivityAt` must
   NOT be bumped on a no-op (it is not today either, the current fast path already returns early).
2. Remove the duplicate `findIndex` (`:1335` vs `:1340`): do the lookup once inside
   `_tabs.update`, record "found / changed" in a local flag, and only fall through to
   `workspacePartition.updateBackgroundTab` (`:1380`) when not found in the active list.
   Behaviour identical; one O(n) scan instead of two.
3. Call `saveTabState()` only when the update actually produced a new tab (not on the skip
   path). Assumption A1 (below) decides whether a streamingState-only update may also skip
   the save.
4. Keep the tab spread and the array copy for real changes. Reason: `tabs()` consumers and
   TASK_2026_336 rely on a new array/tab identity per change; per-tab signals would change the
   public `tabs()` contract and spread far beyond this function (rejected, see Decisions).

Failure behaviour: unchanged — missing tab still warns/delegates; a wrong "equal" verdict is
impossible because comparison is `Object.is` per key (a new state object always differs, which
TASK_2026_336 guarantees).

Tests: extend `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts` (Assumption: spec
exists at that path — implementer confirms with `ptah_search_files "**/tab-manager.service.spec.ts"`):
- multi-key update with all-equal values leaves `tabs()` reference unchanged and does not
  schedule a save;
- a changed `streamingState` still yields a new tabs array and new tab object with bumped
  `lastActivityAt`;
- background-workspace tab still routes to `updateBackgroundTab`.

### 5b. StreamPresentationStore (`chat`)

File: `libs/frontend/chat/src/lib/services/stream-presentation-store.service.ts`.

Design:
1. Close-tab release (`:82`, `:109-114`): replace the effect source with a private
   `computed` of the tab-id list using a custom `equal` (same length + same ids in order), and
   run `releaseClosedTabs` from an effect on that computed. The effect then fires only when the
   tab set changes, not on every streaming flush.
2. Finalized memo per `TabRecords`: add `finalizedSource` (last `tab.messages` ref),
   `finalized`, `finalizedIds`. Recompute `filterCompactionNoise` (`:123`) and the id `Set`
   (`:124`) only when `tab.messages !== finalizedSource`. During streaming `messages` is stable,
   so both allocations disappear from the per-frame path.
3. Streaming message memo per `TabRecords`: `Map<treeId, { tree, statsRef, sessionId, message }>`.
   In `streamingMessages` (`:174-201`) reuse the previous `ExecutionChatMessage` when `tree`
   (identity), `state.pendingStats` (identity) and `tab.claudeSessionId` are unchanged; else
   create and store. Prune entries whose tree id is absent from the current build. With the
   Batch 2 identity cache, unchanged trees keep their reference, so `sameMessage` (`:132`) hits
   and `record.set` is skipped for every non-live tree.
4. Merge memo: if `finalized` and every streaming message are reference-identical to the
   previous sync, reuse `records.previous.messages` and its ids instead of `mergeByTime` +
   `map` (`:126-127`).
5. Tile/consumer sharing (see 5c): add a public `streamingTreesFor(tabId)`? — NO (rejected,
   speculative). The existing `structureFor(tabId)` (`:86-88`) is the shared entry; document on
   the class that every transcript surface (main panel, canvas tile, TASK_2026_629 detail row)
   must read `structureFor` / call `sync`, never `buildTree` with its own key.

All memo state lives in `TabRecords`, so it is released with the tab (`:112`) and on destroy
(`:83`). No timers, observers or per-item subscriptions are added.

Failure behaviour: memos are pure identity checks; a miss rebuilds exactly as today. If Batch 2
is not merged, trees are new each build and memo 3 simply misses (no correctness change).

Tests: extend `libs/frontend/chat/src/lib/services/stream-presentation-store.service.spec.ts`
(Assumption: exists; confirm with `ptah_search_files`):
- two syncs with distinct tab objects but the same `messages` ref call `filterCompactionNoise`
  work once (assert via returned `structure().messages` finalized prefix identity);
- when `buildTree` (mocked `ExecutionTreeBuilderService`) returns the same tree ref, the slot
  record signal is not re-set (record value identity preserved);
- a tab-id-unchanged `tabs()` emission does not delete records; closing a tab does.

### 5c. Single tree build per tab for every surface (`chat`)

File: `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`.

Design: in `_executionTrees` (`:410-419`) always use `` `tab-${this.tabId()}` `` and delete the
`_sessionContext ? 'tile-…'` branch and its comment. A given tab has one `streamingState`
regardless of surface, so main panel, tile and any later detail row share one cache entry and
one build. `_sessionContext` stays (used elsewhere for focus/context — do not remove the
injection unless `ptah_lsp_references` shows `:226` has no other reader). No template, layout
or canvas change.

Interaction: `clearForTab` (`execution-tree-builder.service.ts:782-784`) runs on finalization
and transcript-retention eviction "while a tile may still show the tab". After unification
that clear also drops the tile's entry, costing at most one rebuild on the next read — correct,
just not free. Assumption A2 covers whether the per-key cache holds anything besides the
state->trees memo.

Dead code created: the `tile-` clears at `execution-tree-builder.service.ts:795` and
`compaction-lifecycle.service.ts:508` become no-ops. `execution-tree-builder.service.ts` is
owned by Batch 2; hand both removals to the Batch 2 owner (or a follow-up commit after both
batches) rather than editing a file another batch is changing.

Tests: `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.spec.ts`
(Assumption: exists): with the flag token overridden to `false` and a `SESSION_CONTEXT`
provided, `buildTree` is called with `tab-<id>`; with the flag on, the store is the only
`buildTree` caller.

### 5d. Shared tool-input parse cache (`chat-types`, created in Batch 5)

Location: `libs/frontend/chat-types/src/lib/tool-input-parse-cache.ts`, exported from
`libs/frontend/chat-types/src/index.ts`. Reason: the three call sites live in three
`type:feature` libs (`chat-execution-tree`, `chat`, `chat-ui`); `chat-types` is `scope:webview,
type:util`, importable by all of them, and a framework-free pure function fits `type:util`
(it must import nothing but `type:util` libs — it needs no imports at all). Assumption A3:
`type:feature` may depend on `type:util` (the depConstraints excerpt was cut after
`type:data-access`; implementer confirms in `eslint.config.*`).

Contract:
- `parseToolInputCached(toolCallId: string, raw: string): ToolInputParseResult` where
  `ToolInputParseResult = { success: true; data: Readonly<Record<string, unknown>> } |
  { success: false; error: string; raw: string }` (same shape as `tool-node.fn.ts:269-279`
  `ParseResult`).
- Module-level `Map<string, { raw: string; result }>`; hit only when `raw` is identical to the
  cached raw (accumulators grow while streaming; all three call sites only parse once a result
  exists, so a hit is the common case). Re-insert on hit for LRU order; evict oldest past a
  fixed cap of 256 entries (bounded memory; large Write/Edit inputs cannot accumulate without
  limit). No timers.
- Same id + different raw -> reparse and replace. Non-object JSON -> `{ success: false,
  error: 'Not an object' }` exactly as today.
- Returned `data` is shared across callers: treat as read-only (typed `Readonly`); callers that
  mutate must copy. Implementer checks with `ptah_lsp_references` that no consumer of
  `toolInput` in `tool-node.fn.ts` mutates it.

Batch 5 migrates only `tool-node.fn.ts` (`:176` call, delete local `parseToolInput` `:269-279`).
The agent-monitor (`agent-monitor-tree-builder.service.ts:642`) and compact-summary
(`compact-session-summary.ts:320`, which must map failure back to returning `input`) owners
migrate their own sites after Batch 5 lands — ordering dependency for the team-leader.

Tests: CREATE `libs/frontend/chat-types/src/lib/tool-input-parse-cache.spec.ts` — same raw
returns identical result object; changed raw reparses; invalid JSON / non-object produce the
failure shape; cap eviction drops the oldest id. Assumption A4: `chat-types` has a Jest target
(`npx nx show project chat-types`); if not, add the spec under `chat-execution-tree` and keep
the helper there only if the eslint check in A3 fails (see Decisions).

### Risks
- R1: generalised no-op skip hides an update a caller relied on to bump `lastActivityAt` or
  trigger a save. Mitigation: only identical values are skipped; spec covers it.
- R2: unifying the tree key exposes a hidden reason for tile isolation (A2).
- R3: shared parsed object mutated by one consumer leaks into another (5d read-only rule).
- R4: merge conflict with `fix/session-budget-handoff` — kept to `updateTabInternal` body only.

## 3. Files touched

MODIFY
- `D:\projects\ptah-wt-628\libs\frontend\chat-state\src\lib\tab-manager.service.ts` (only `updateTabInternal`)
- `D:\projects\ptah-wt-628\libs\frontend\chat\src\lib\services\stream-presentation-store.service.ts`
- `D:\projects\ptah-wt-628\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
- `D:\projects\ptah-wt-628\libs\frontend\chat-execution-tree\src\lib\builders\tool-node.fn.ts`
- `D:\projects\ptah-wt-628\libs\frontend\chat-types\src\index.ts`
- specs: `tab-manager.service.spec.ts`, `stream-presentation-store.service.spec.ts`, `chat-transcript.component.spec.ts`, tool-node builder spec if present (paths to confirm)

CREATE
- `D:\projects\ptah-wt-628\libs\frontend\chat-types\src\lib\tool-input-parse-cache.ts`
- `D:\projects\ptah-wt-628\libs\frontend\chat-types\src\lib\tool-input-parse-cache.spec.ts`

NOT touched (other owners): `batched-update.service.ts`, `execution-tree-builder.service.ts`
(Batch 2), `agent-monitor-tree-builder.service.ts`, `compact-session-summary.ts`,
`compaction-lifecycle.service.ts`.

## 4. Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep tab/array copy on real change; cut no-op copies, double scan, and save churn | (a) per-tab signals; (b) mutate in place + `equal: () => false`; (c) local no-op skip | (a)/(b) break `tabs()` identity contract and TASK_2026_336; array is O(open tabs), small; other branch edits the file | Yes |
| Shared tile build via one `tab-` key + store as sole entry | (a) keep `tile-`, add store accessor for tiles; (b) unify key | Flag on: store already uses `tab-` (`stream-presentation-store.service.ts:180`); `tile-` only in fallback (`chat-transcript.component.ts:410-419`) | Yes |
| Parse cache in `chat-types` | (a) `chat-types` (util); (b) `chat-execution-tree` (feature) and others import it; (c) per-lib copies | three `type:feature` libs consume; util is importable by all; (b) adds feature->feature edges from `chat-ui`; (c) duplicates a third time | Yes |
| Cache bound 256 entries, LRU, no timer | TTL timer vs LRU cap | Runtime-cost rule: no timers; inputs can be large | Yes |
| Dead `tile-` clears removed by Batch 2 owner | edit now vs hand off | file owned by Batch 2 | Yes |

Assumptions:
- A1: whether persisted tab state includes `streamingState`. Check the serializer called from `saveTabState` (`tab-manager.service.ts:2659+`). If excluded, also skip `saveTabState` for streamingState-only updates.
- A2: per-key tree-builder cache holds only a state->trees memo. Check `buildTree`/`clearCache` in `execution-tree-builder.service.ts`; if it holds per-surface UI state, keep `tile-` and instead route tiles through the store only.
- A3: `type:feature` -> `type:util` allowed in `eslint.config.*`.
- A4: `chat-types` has a test target.

## Clarifications Needed

None — the brief carries the decisions; open points are assumptions with checks.

## 5. After-trace checklist

- Per streaming flush, `TabManagerService.updateTabInternal` shows one `findIndex`; no new tabs array when the update is a no-op; `setTimeout` from `saveTabState` no longer re-armed on no-ops.
- `StreamPresentationStore.releaseClosedTabs` absent from per-flush frames; appears only on tab open/close.
- `filterCompactionNoise` and `new Set` in `syncTab` absent while only `streamingState` changes.
- `createExecutionChatMessage` called once per changed tree per frame (the live tree), not once per tree.
- With main panel and canvas tile on the same tab: exactly one `buildTree` per published tab snapshot, key `tab-<id>`; no `tile-<id>` key in the cache.
- `JSON.parse` for a completed tool appears once per (toolCallId, raw), not per rebuild.
- Retained heap: no growth in parse cache beyond 256 entries; `TabRecords` memos released on tab close.

## Implementer verification rules (STRICT, CLAUDE.md)

- Test only changed projects: `npx nx test <project>` / `npx nx typecheck <project>` / `npx nx lint <project>` for `chat-state`, `chat`, `chat-execution-tree`, `chat-types`; or Jest on changed specs: `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
- Nx `--parallel=1`; Jest `--maxWorkers=2`.
- One heavy check at a time across all lanes; never start a second while one runs.
- No workspace-wide runs; no `nx run-many` across unchanged projects.
- No build / serve / dev / e2e / package targets.
- Prefer one foreground run with a long timeout; filter output (`| tail`, `grep`) instead of re-running.


---

# Part B3

# Plan Part B3 - TASK_2026_628_5ab5 (hot spots 6 and 7)

Status: COMPLETE (architect, read-only pass, 20-call budget)

## Implementer verification rules (STRICT, CLAUDE.md)

- Test only changed projects: `npx nx test <project>` / `npx nx typecheck <project>` / `npx nx lint <project>`, or Jest on changed specs: `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
- Nx `--parallel=1`. One heavy check at a time across all lanes; never start a second while one runs.
- No workspace-wide runs, no `nx run-many` over projects you did not change.
- No build / serve / dev / e2e / package targets.
- One foreground run with a long timeout; filter output (`| tail`, `grep`) instead of re-running.

## 1. Verified table

All paths are repo-relative to the worktree `D:\projects\ptah-wt-628`.

| Claim | Status | Location |
| --- | --- | --- |
| `summarizeLive` at ~155-186 redacts the full accumulated block text per `text_delta` | CONFIRMED, and worse than stated. `liveItems` loops over EVERY event in `state.events` on every call and calls `liveEventItem` for each. Every `text_delta` event of the same block rebuilds that block's item and runs `redactAbsolutePaths(accumulated)` on the whole accumulated text; the Map keeps only the last one. Cost of one publish = (deltas in block) x (block length), so over a whole stream it grows faster than quadratic | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts:155-167` (loop), `:174-189` (prose item), `:185` (redact) |
| `redactAbsolutePaths` is four replaces | CONFIRMED: two `replaceAll` calls when a workspace is set, plus two regex `replace` calls | `compact-session-summary.ts:747-757` |
| Tool inputs re-parsed on each publish (~:320) | CONFIRMED: `toolInputOf` runs `JSON.parse` on the `toolInputAccumulators` text for every `tool_start` and every `tool_result` event on every publish | `compact-session-summary.ts:311-332` (parse `:320`), callers `:194`, `:234` |
| Sorts on each publish | CONFIRMED, twice: `liveItems` sorts all items then `slice(-MAX_ITEMS)`, and `buildSummary` sorts the marks | `compact-session-summary.ts:164-166`, `:503-505` |
| `findToolStart` is cheap | CONFIRMED: it is a `toolCallMap` lookup, not a scan of all events | `compact-session-summary.ts:296-305` |
| `summarizeLive` has one call site | CONFIRMED: the `CompactSessionCardComponent.summary` computed, which re-runs on every `tab()` change (each streaming publish) | `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:122-139` (call at `:137`) |
| The non-canvas compact path also calls it on every delta | CONFIRMED: the same card is the only mount, and `chat-view` renders it in compact view mode. The main panel and any canvas tile that hosts a chat-view both reach `summarizeLive` through this one component | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:4-13` |
| Tile cap `MAX_CANVAS_TILES = 20` | Not re-opened (budget); the brief cites `libs/frontend/canvas/src/lib/canvas-layout-intent.ts:13`. Batch 7 does not touch it | - |
| Canvas tiles are rendered as `gridstack-item` inside the Angular gridstack wrapper and keyed by `tabId` | CONFIRMED | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:108-144` (`@for ... track item.tabId` at `:121`) |
| The grid component holds a per-tile `creationOptions` Map | CONFIRMED. Entries are pruned inside the `items` computed, which only runs when it is read. The objects do not hold `el`: the wrapper copies them (`{...val, el}`) | `canvas-workspace-grid.component.ts:321-354`; wrapper `node_modules/gridstack/dist/angular/src/gridstack-item.component.ts:89-97` |
| The grid component tolerates stale engine nodes | CONFIRMED: `applyLayout` iterates `grid.engine.nodes` and skips (`continue`) any node whose id is no longer in the layout. It never evicts that node | `canvas-workspace-grid.component.ts:758-761` |
| The grid component's `ngOnDestroy` releases nothing tile-related | CONFIRMED: it only resets the gesture fields | `canvas-workspace-grid.component.ts:883-886` |
| The wrapper removes items only through `QueryList.changes`, then `updateAll`, then `grid.load(layout)` diff | CONFIRMED. `updateAll` returns early if `!this.grid` | `node_modules/gridstack/dist/angular/src/gridstack.component.ts:277-307` |
| `GridstackItemComponent.ngOnDestroy` does not remove its node from the engine | CONFIRMED: it deletes `_gridItemComp`, `container`, `ref` and options only. `el.gridstackNode` (and through it `grid`, `engine.nodes[i].el`) is left for `load()` to clean up | `node_modules/gridstack/dist/angular/src/gridstack-item.component.ts:114-124` |
| `GridStack.removeWidget(el, removeDOM, triggerEvent)` breaks the circular link and drag/drop references, and is idempotent | CONFIRMED: deletes `el.gridstackNode`, calls `_removeDD(el)` and `engine.removeNode`. If the node is gone it returns (falls back to an `engine.nodes.find`). It skips an element whose `parentElement` is a different grid | `node_modules/gridstack/dist/gridstack.js:1226-1257`; `gridstack-engine.js:786-799` |
| `engine.removedNodes` is cleared only when an event fires outside batch mode | CONFIRMED: with `triggerEvent=false`, `removeNode` never pushes to it | `gridstack.js:1713-1721`; `gridstack-engine.js:791-793` |
| The exact retainer named in the trace ("ElementRef.nativeElement in a JS array") | ASSUMPTION, not proven statically. Candidates, in order of likelihood: (a) a stale `grid.engine.nodes[i]` whose `el` is the detached `gridstack-item`, left when the wrapper's `updateAll` diff did not run or did not remove it (the grid code tolerates such nodes, see `:758-761`); (b) drag/drop handler state for an element `_removeDD` was never called on; (c) a destroyed `GridstackItemComponent` (holding `elementRef`) still in a stale `QueryList._results` array or Angular LView array. The implementer resolves this with the heap-snapshot retainer path in section 5 before and after the fix | - |
| A prior fix exists for closed-tile caches (PR #645, `canvas-tile-leaks`) | CONFIRMED: it freed per-tile caches and paused hidden tiles. It did not touch gridstack engine or drag/drop cleanup | `.ptah/specs/canvas-tile-leaks/task.md:1-20` |

## 2. Batch 6 - make `summarizeLive` linear (hot spot 6)

Nx project: `chat-ui` (`libs/frontend/chat-ui`). `chat` (`libs/frontend/chat`) only if the card needs a change, and it does not (see the Decisions section).

### Design

The function stays pure: same signature, same `CompactSessionSummary` output, same item ids, same tie-break order. Three changes in `compact-session-summary.ts`:

1. **One pass per block, not one per delta.** Rework `liveItems` (`:155-167`) so that `text_delta` events do not call `liveEventItem` one by one. In the event loop:
   - record only the newest `text_delta` event per `blockId` (`${messageId}:prose:${blockIndex}`), keeping the first timestamp the current `Map.set` semantics would keep;
   - after the loop, build each prose item once from its accumulator (`textAccumulators.get(`${messageId}-block-${blockIndex}`)`).

   Timestamp detail: the current code calls `items.set` with the last delta's item, but `Map` keeps insertion order. Insertion order is irrelevant because of the sort. Keep exactly the current semantics: the item's timestamp is the LAST delta's timestamp (the last `set` wins). Pin this with a test.

   Non-prose events keep the existing `liveEventItem` path. This removes the "deltas x length" factor; redaction becomes one pass per block per publish.

2. **Redact each block once, using a bounded memo.** Add a module-level memo for prose redaction, keyed by block id. Each entry stores `{ workspacePath, rawLength, rawTail, redacted }`.
   - Reuse rule: reuse `redacted` only when `workspacePath` matches AND the raw text's length and last `min(64, length)` characters equal the stored ones (the accumulators only append, so length plus a tail check is enough). On a mismatch, redact again and overwrite the entry.
   - Why not redact only the new suffix: the path regexes (`:755-756`) can match across a chunk boundary. A path split between two deltas would leak an unredacted prefix. Re-redacting a block only when its text changed keeps correctness. The cost per publish is then O(total size of blocks that changed), which is normally one block, the open tail.
   - Bound the memo with an LRU of 256 entries (a `Map` delete-and-reinsert on hit, evict the first key while size > 256), so a long-lived renderer cannot grow it without limit. It is a plain module-level cache with no timers or observers, which satisfies the runtime-cost rule.
   - Rejected: a `WeakMap` keyed by `StreamingState`. The streaming state object is replaced immutably on each publish (Assumption: check `StreamingState` updates in the chat store; if the object is mutated in place, a `WeakMap<StreamingState, Map<blockId, entry>>` is the better key and needs no LRU).

3. **No full sort per delta.**
   - `liveItems`: replace sort-then-`slice(-MAX_ITEMS)` with a bounded top-K selection on `(timestamp, id)`: keep the newest `MAX_ITEMS` (48) in a small sorted array with insertion, then return it ascending. Output order is identical. With 48 kept items the cost is O(n) in the number of distinct items instead of O(n log n), and it allocates no full copy.
   - `buildSummary` (`:503-505`) sorts at most 48 semantic items plus prompt and compaction marks. That is already bounded, so it is left unchanged. Do not touch it; `summarizeFinalized` shares it.

**Tool-input parse (`toolInputOf`, `:311-332`, parse at `:320`).** Out of scope here. The shared tool-input `JSON.parse` cache is designed by another architect. Call sites to wire into that cache: `compact-session-summary.ts:194` (`tool_start`) and `:234` (`tool_result`). Do not add a separate cache in this batch.

**Sampler.** None added (see the Decisions section). `summarizeLive` has exactly one call site, `compact-session-card.component.ts:137`, which serves both the canvas and the non-canvas compact view.

### Failure behaviour

- A memo miss or mismatch makes the code fall back to a full redaction of that block, which is today's behaviour. It never returns unredacted text.
- A missing accumulator falls back to `event.delta`, as at `:179`.
- If the `workspacePath` changes, every entry misses, because the path is part of the key check.

### Tests (spec: `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.spec.ts`)

- **Output parity:** for a stream of N deltas over 2 blocks plus tool start and result, the result equals a fixture built the old way (snapshot of ids, labels, text and timestamps). This includes the last-delta timestamp rule.
- **Redaction work is linear:** spy on `String.prototype.replace` / `replaceAll`, or export the redaction helper only through a test seam already used in the spec (Assumption: check the spec's existing seams first; if there are none, count calls with `jest.spyOn(String.prototype, 'replaceAll')`). For 200 deltas in one block, one `summarizeLive` call redacts that block at most once, and a second call with an unchanged accumulator redacts it zero times.
- **Chunk-boundary path:** the accumulator grows from `"see C:\\Users\\a"` to `"see C:\\Users\\abd\\x.ts"`. The final text has no `C:\` and no `Users`.
- **Workspace change:** the same block with a different `workspacePath` is redacted again.
- **Top-K:** 60 distinct items keep the newest 48 in ascending `(timestamp, id)` order, with ties broken by id.
- **LRU bound:** after 300 distinct blocks the memo size is at most 256 (only if the memo is exposed for tests; otherwise assert behaviour only).

Commands: `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.spec.ts --coverage=false --maxWorkers=2`, then `npx nx typecheck chat-ui --parallel=1`, then `npx nx lint chat-ui --parallel=1`.

### Risks

- Timestamp semantics drift (first versus last delta) would reorder marks. The parity test pins it.
- A module-level memo is shared across tabs. Keys include `messageId`, which is unique per message, so there is no cross-tab collision. Assumption: message ids are globally unique, not per tab.
- Merge conflict with TASK_2026_629 if 629 edits the same file. 629 owns the card, not this pure module. Coordinate if 629 touches `compact-session-summary.ts`.

## 2. Batch 7 - release a closed canvas tile's gridstack item (hot spot 7)

Nx project: `canvas` (`libs/frontend/canvas`). Do not change layout geometry, `canvas-layout-intent.ts`, or `MAX_CANVAS_TILES`. TASK_2026_629 owns layout.

### Design

**Owner.** `CanvasWorkspaceGridComponent` already owns the GridStack instance (`this.gridComp()?.grid`, `canvas-workspace-grid.component.ts:747`) and already reads `grid.engine.nodes` (`:758`, `:853`). The release goes there. `CanvasTileComponent` does not own the grid and must not reach up into it.

1. **Evict stale engine nodes when the tile set changes.**
   - Add a private `releaseRemovedNodes(grid)` that walks `grid.engine.nodes`. For each node whose `id` is a string not in the live tile id set (`this.tiles()`), it calls `grid.removeWidget(node.el, false, false)`:
     - `removeDOM=false`: Angular owns and has already removed the DOM.
     - `triggerEvent=false`: the node is never pushed to `removedNodes` and no `change` event re-enters `onGridChange`.
     - `removeWidget` deletes `el.gridstackNode`, calls `_removeDD(el)` and filters the node out of `engine.nodes` (`gridstack.js:1244-1247`). It is idempotent when the wrapper's own `load()` diff already removed the node (`:1236-1240`).
     - Guard: skip a node without `el`. Collect the list first and remove after the walk, because `removeNode` reassigns `engine.nodes`.
   - Call it from an `effect` that reads `this.tiles()` and runs `untracked` against the grid (or from an `afterRenderEffect`, so it runs after the `@for` has destroyed the item and `updateAll` has had its turn). Assumption: check whether the component already has an after-render hook that applies the layout (`applyLayout` around `:720-845`). If it has, call `releaseRemovedNodes` at the top of that hook instead of adding a new effect, and before `applyNodeInteractionState`, so the stale-node `continue` at `:761` never sees evicted nodes.
   - Also clear `_gesture` (through the existing `cancelGesture`, `:478`) when `_gesture.draggedId` is no longer live.

2. **Prune `creationOptions` without relying on a read of `items`.** Move the prune loop (`:326-329`) into the same release step, so it does not depend on the `items` computed being read. Keep `items` side-effect-free. The prune is the same loop, moved, not duplicated.

3. **Full release on destroy.** In `ngOnDestroy` (`:883`), also call `this.creationOptions.clear()`. The wrapper's own `ngOnDestroy` calls `grid.destroy()` (`gridstack.component.ts:288`), so do NOT call `removeAll` here. Double teardown risks touching `this.el` after destroy.

### Failure behaviour

- If `grid` is undefined (wrapper not initialised or already destroyed), the release step is a no-op, which is today's behaviour.
- `removeWidget` cannot throw on a missing node. Wrap the per-node call in nothing: a throw there is a real bug and should surface in tests.
- If an evicted node belonged to a tile that is re-added with the same `tabId`, the wrapper's `updateAll` and `load()` add it again from the new `gridstack-item`. The `creationOptions` entry is recreated from the derived position, so the layout is unchanged.

### Tests (spec: `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts`)

Assumption: check whether this spec mounts real gridstack in jsdom or a stub (`libs/frontend/tribunal-panel/src/test-gridstack-stub.ts` exists for another lib). Use whatever the spec already uses.

- **"releases the gridstack node and drag handlers of a closed tile":**
  1. Mount with tiles A and B and run change detection plus render.
  2. Capture `itemEl = fixture.debugElement.query(gridstack-item containing tabId B).nativeElement`.
  3. Call `canvasStore.removeTile('B')` and flush.
  4. Assert that `grid.engine.nodes` has no node with `id === 'B'`, that no node has `el === itemEl`, and that `itemEl.gridstackNode` is `undefined`.
  5. Assert that `grid.engine.removedNodes` does not contain the node.
  6. Assert that `creationOptions` has no `'B'` key (read through a test seam or `(component as any)` per the spec's existing convention).
- **"evicts a node left behind when the wrapper diff did not run":** push a fake stale node `{ id: 'ghost', el: document.createElement('gridstack-item') }` with `grid.engine.nodes = [...nodes, ghost]` (or simulate `updateAll` skipped), trigger a tile change, and assert `ghost` is gone. This pins the `:758-761` tolerance gap.
- **"destroy clears per-tile options":** `fixture.destroy()` leaves `creationOptions.size === 0`.
- **Regression:** existing layout tests in the same spec must still pass unchanged (no geometry change).

Commands: `npx jest -c libs/frontend/canvas/jest.config.ts libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts --coverage=false --maxWorkers=2`, then `npx nx typecheck canvas --parallel=1`, then `npx nx lint canvas --parallel=1`.

### Risks

- If the heap retainer turns out to be (c), a stale `QueryList` or LView, evicting engine nodes will not fully fix it. The section 5 check decides this. If the retainer is still present after the fix, escalate with the retainer path; do not add speculative cleanup.
- A conflict with TASK_2026_629 edits to `canvas-workspace-grid.component.ts`. Keep the change to one private method, the `ngOnDestroy` line and the moved prune loop. Layout methods are untouched.
- Calling `removeWidget` with `triggerEvent=true` would re-enter `onGridChange` during layout. Must be `false`.

## 3. Files to touch

MODIFY:

- `D:\projects\ptah-wt-628\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-summary.ts` (Batch 6)
- `D:\projects\ptah-wt-628\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-summary.spec.ts` (Batch 6)
- `D:\projects\ptah-wt-628\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.ts` (Batch 7)
- `D:\projects\ptah-wt-628\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.spec.ts` (Batch 7)

NOT touched:

- `compact-session-card.component.ts` (629 owns the sampler)
- `canvas-tile.component.ts`
- `canvas-layout-intent.ts`
- anything under `node_modules`

The two batches are file-disjoint and project-disjoint (`chat-ui` versus `canvas`), so they can run in parallel. Run their checks one at a time.

## 4. Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| D6.1: collapse `text_delta` events to one item per block per call | (a) collapse in the loop (chosen); (b) keep the per-event path plus a memo only | Every delta re-redacts the full block at `:160-162`, `:185`. A memo alone still pays a Map lookup and tail compare per delta | Yes, local to a pure function |
| D6.2: re-redact the whole changed block, memoised by (blockId, workspacePath, length, tail) | (a) whole changed block (chosen); (b) redact only the appended suffix | The path regexes at `:755-756` can span a chunk boundary, so (b) can leak a path prefix | Yes |
| D6.3: no sampler in 628 | (a) none; rely on 629's 500 ms card sampler (chosen); (b) add a sampler at `compact-session-card.component.ts:137` for the non-canvas path | There is one call site, and that card is the only mount for both canvas and non-canvas (`chat-view.component.html:9`). A 628 sampler there would duplicate and conflict with 629's | Yes. If 629 gates its sampler to canvas-only, 628 adds no second sampler; 629 should drop the gate (see Clarifications) |
| D6.4: tool-input parse cache deferred | Wire to the shared cache from the other architect | `:194`, `:234`, `:320` | Yes |
| D7.1: release in `CanvasWorkspaceGridComponent`, not in `CanvasTileComponent` | (a) grid component (chosen); (b) tile reaches its parent `gridstack-item._gridItemComp` and grid | The grid owns `gridComp().grid` (`:747`) and already walks `engine.nodes` (`:758`, `:853`); the tile has no grid reference | Yes |
| D7.2: `removeWidget(el, false, false)` | (a) `removeDOM=false`, `triggerEvent=false` (chosen); (b) defaults | Angular owns the DOM; `triggerEvent=true` fills `removedNodes` and fires `change`, which re-enters `onGridChange` (`gridstack.js:1252-1255`) | Yes |
| D7.3: no `removeAll` or `destroy` in our `ngOnDestroy` | The wrapper already calls `grid.destroy()` | `gridstack.component.ts:285-293` | Yes |

## Clarifications Needed

None blocking. One coordination note for the orchestrator to pass to TASK_2026_629: `summarizeLive`'s only call site is `CompactSessionCardComponent.summary` (`compact-session-card.component.ts:122-139`), and that card is mounted by `chat-view` in compact mode for both the canvas and the main panel. 629's 500 ms sampler in that card therefore covers the non-canvas path too, but only if it is not gated to canvas. If 629 gates it, 629 should remove the gate; 628 should not add a second sampler.

## 5. What to look for in the after-trace and heap snapshot

### Hot spot 6 (Performance trace, 3+ sessions streaming in compact view)

- Self time of `redactAbsolutePaths`, `String.prototype.replace` and `replaceAll` under `summarizeLive` falls from scaling with stream length to roughly constant per publish (one block).
- `liveItems` no longer shows `Array.prototype.sort` per publish. The `buildSummary` sort is bounded at 48 or fewer items and stays.
- Bottom-up "Minor GC" frequency during streaming drops, because there are no longer per-delta copies of the full block strings.
- `JSON.parse` under `toolInputOf` stays until the shared cache lands. Expected, and not a regression.

### Hot spot 7 (Memory > Heap snapshot)

1. Open 3 canvas tiles with long transcripts, take snapshot 1, close one tile, force GC (trash icon), take snapshot 2.
2. In snapshot 2, filter "Detached": expect NO `Detached <gridstack-item>`, `Detached <ptah-canvas-tile>` or detached `chat-msg-slot` trees attributable to the closed tile. The 18,898-node tree must be gone.
3. If one remains, open its Retainers. Record the first non-DOM retainer:
   - `nodes` in `GridStackEngine`: the fix did not run (check the hook placement).
   - `DDElement`, `_dd` or `dd-manager`: `_removeDD` was skipped.
   - `_results` in `QueryList`, or an `LView` array: a wrapper or Angular retention, outside this fix. Escalate with the path.
4. Comparison view (snapshot 2 vs 1): `HTMLElement` delta about minus the closed tile's node count; `GridstackItemComponent` and `CanvasTileComponent` counts drop by 1.
5. Close all tiles and re-open one. The counts return to the single-tile baseline, with no growth across 5 open/close cycles.


---
