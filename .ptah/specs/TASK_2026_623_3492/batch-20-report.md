# Batch 20 report — C5 display-panel entry, surfaces and sync

Executor: frontend-developer. No git commands run. `src/index.ts`, batches.md, decisions.md and task.md untouched.

## Tasks

### Task 20.1 `display-surfaces.ts` pure computation — COMPLETE

- `buildDisplaySurfaces(candidates, compile, resolve, previous)` composes two pure halves:
  - `compileDisplayFences`: segments candidates in R2.8 order (stable sort by `orderKey`, input order breaks ties)
    and compiles each closed `display` fence once. Unclosed fences yield nothing (R2.7). The reserved `ptah.` check
    runs before compile ("reserved display id").
  - `applyDisplayFences`: resolves in order and applies the D11 keys, the cap and the statuses.
- Also exports `displayFenceSources`, `displaySurfaceKey` and `anonymousDisplaySurfaceId`.
- Evidence: `display-surfaces.spec.ts` has 19 cases, all passing. They cover:
  - R1.12: 8 ids; a 9th id (evicted plus chip-shaped status); a 9th that reuses an id; LRU by update; every fence of an
    evicted surface marked evicted;
  - R2.3: fresh equals updated;
  - R2.4: the accordion is retained and the changed stat is not;
  - R2.5: reserved id, with compile never called;
  - R2.6: invalid update, and a failing or throwing resolve;
  - R2.8: order across messages, nodes and ordinals;
  - R2.9: rebuild equality;
  - anonymous keys and the chip lookup key;
  - unclosed fences, untitled blocks, and the turn and live flags;
  - compile once per fence, a throwing compile, and the sources a fence uses.

### Task 20.2 surface sync, entry file, tsconfig path, write port — COMPLETE

- `DisplaySurfaceSyncComponent` (`ptah-display-surface-sync`, headless, `template: ''`):
  - inputs: `tabId`, `candidates`, `snapshots` (map keyed by message id);
  - compile cache keyed by `surfaceId NUL body`, pruned each pass to the fences still present;
  - resolve cache per fence key, reused when the compiled block, snapshot, `$agents` and `$limits` identities are
    unchanged;
  - the `$agents` signal is created once per turn index;
  - the `$limits` read is acquired and released by reference as fences start or stop naming it, and released on
    destroy;
  - it publishes through `PTAH_UI_DISPLAY_DOCK_SYNC`.
- `ptah-ui-display-dock.ts` adds `PtahUiDisplaySurfacesPublication`, `PtahUiDisplayDockSync` and
  `PTAH_UI_DISPLAY_DOCK_SYNC`:
  - write port methods: `surfaces`, `setSurfaces`, `hasSeen`, `markSeen` and `requestAutoOpen`;
  - the read port `PTAH_UI_DISPLAY_DOCK` is unchanged;
  - the file's runtime imports are `@angular/core` only; `DisplaySurface` is `import type`.
- `src/display-panel.ts` is the new lazy entry. `tsconfig.base.json` has the new path
  `@ptah-extension/chat-ui/display-panel`.
- Evidence: `display-surface-sync.component.spec.ts` has 14 cases, all passing:
  - R1.8 sequence: open; user close; second block in the same turn stays closed with `newCount` 1; next turn's block
    opens;
  - R1.9: replay is silent, and a remount over the same live candidates does not reopen;
  - only applied fences request (invalid and reserved never do);
  - R1.10: no `ptah.` key;
  - R1.7: focus unchanged;
  - chip-shaped status lookup;
  - compile once while text streams, with resolve reused;
  - R2.7: an unclosed fence;
  - D10 retained view state across publications;
  - the `$limits` acquire/release lifecycle;
  - the turn snapshot is read;
  - absent token: no compile, no acquire, no throw;
  - no DOM.

**D12 verdict:** the port carries D12 auto-open (`requestAutoOpen` + store-held `seenBlockKeys` via `hasSeen`/`markSeen`). No architect escalation needed.

## Files

- CREATED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\display-surfaces.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\display-surfaces.spec.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\display-surface-sync.component.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\display-panel\display-surface-sync.component.spec.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\display-panel.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\services\ptah-ui-display-dock.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\tsconfig.base.json

## Verification (worktree, memory-safe, one heavy check at a time)

- Jest command:
  `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/display-panel --coverage=false --maxWorkers=2`
  - Without a mapper it fails to resolve `marked` through `ngx-markdown`, because the sync imports the `ptah-ui` block
    tokens.
  - With the permitted command-line `--moduleNameMapper` (`^vscode$`, `^marked$`), 2 suites and 33 tests pass.
  - A final re-run that also included the unchanged `ptah-ui-display-chip.component.spec.ts` passed 3 suites, 61
    tests.
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1`: "Successfully ran target typecheck".
  - The first run failed with TS2339: `.surface` on the `SurfaceContent` union in `display-surfaces.ts`.
  - I fixed it by reading the title, description and signatures from the converted envelope. The specs now narrow
    with `contract === 'dashboard-spec/2'`.
- `npx nx lint @ptah-extension/chat-ui --parallel=1`: 0 errors and 10 warnings. That is the same baseline count as
  Batches 18 and 19, and none of the warnings is in a batch file.
- No TODO, FIXME or placeholder markers and no timers in the batch files. The dock file's only runtime import is
  `@angular/core`.

## Risks and edge cases

- **Reserved `ptah.` id:** rejected before compile with "reserved display id". The fence is `invalid`, gets no surface
  and makes no request (both specs).
- **Cap eviction:** the cap is read from `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId`, not copied.
  - The recency order is a `Map` insertion order, and an update re-inserts its key.
  - The least recently created or updated surface is dropped, and all of its fences (superseded ones included) become
    `evicted` with `surfaceKey`, `title` and `description`.
  - A 9th block that reuses an id removes nothing.
- **Status keying:** every status is keyed with `displayFenceKey(messageId, nodeId, ordinal)`.
  - `applied`, `superseded` and `evicted` carry `surfaceKey`, `title` and `description` (`null` when absent);
    `invalid` carries `reason`.
  - A chip-shaped lookup is asserted in both specs.
- **Auto-open:** requested only for a fence whose final status is `applied`, whose candidate is `live`, and whose key is
  not yet seen in the store.
  - All published fences are then marked seen, so a remount or a replay cannot re-trigger.
  - The user-close rule and `newCount` belong to the store (Batch 23); the spec's fake store implements them.
- **Summary never auto-opens:** the sync never handles the summary, and agent keys can never be `ptah.` keys.
- **Absent sync token:** the constructor registers no effects, so nothing is computed, compiled, acquired or written,
  and nothing throws.
- **Streaming:** only closed fences are compiled. The same body is never recompiled, and an unchanged resolve result is
  reused, so its identity stays stable.
- **No timers or observers:** none per surface or at all. Every cache is pruned to the latest pass.

## Plan deviations (numbered for a ruling)

1. **`DisplayCandidate` gains `messageId` and `nodeId`.** The plan lists only `blockKey`, `orderKey`, `text`, `turnKey`
   and `live`.
   - Why: `displayFenceKey(messageId, nodeId, ordinal)` needs both ids, and splitting `blockKey` on `:` is unsafe for
     ids that contain `:`.
   - The type is defined in chat-ui (`display-surfaces.ts`, exported as a type from the `display-panel` entry).
   - Batch 22's `collectDisplayCandidates` must populate both fields and should use `import type` (erased, so it adds
     nothing eager).
2. **`hostSources` is injected, not an input.** The sync reads the optional `PTAH_UI_HOST_SOURCES` token that the
   transcript provides, the same precedent as `PtahUiBlockComponent`. Plan component 5 lists it as an input.
3. **Write port shape** (`PtahUiDisplayDockSync`). Besides `setSurfaces(tabId, {surfaces, statuses})` and
   `requestAutoOpen(tabId, turnKey, surfaceKey)`, the port carries:
   - `surfaces(tabId)`: the previous surfaces for D10, so view state also survives a sync remount;
   - `hasSeen(tabId, fenceKey)` and `markSeen(tabId, fenceKeys)`: the store-held `seenBlockKeys`.

   The seen key is the `displayFenceKey`, which is identical to `blockKey:ordinal`. Batch 23's `DisplayDockState`
   must implement all five methods.
4. **D10 is published as `retainedViewStateIds` on each surface.**
   - The store keeps only those component entries, and drops view state for keys that are absent.
   - The ids are those whose converted (pre-resolve) form is equal, with children compared by id only. Live source
     ticks therefore never collapse expanded components, and a change inside a container keeps the container's own
     state.
   - Batch 23 applies the filter.
5. **The pure function is split into `compileDisplayFences` + `applyDisplayFences`**, with `buildDisplaySurfaces`
   composing them under the plan's signature.
   - Why: the sync recompiles only when candidates change. A source tick re-resolves only (D5).
   - `DisplayResolve` takes a third argument, `fenceKey`, which the sync uses as its resolve cache key.
6. **The sync imports `PTAH_UI_BLOCK_PIPELINE` / `PTAH_UI_BLOCK_LIVE_SOURCES`** from the lazy `ptah-ui` block file, to
   reuse the same pipeline and live-source adapters.
   - Both entries are lazy, so the eager closure is unaffected; worth noting for the Batch 32 gate.
   - Side effect: the sync spec needs the existing `marked` command-line mapper in the worktree.
7. **Title and description come from the converted envelope**, not from the resolved content. `SurfaceContent` is a
   union, and the resolver never rewrites the envelope title or description (`ptah-ui-resolver.ts` sets only table
   descriptions).
8. **Anonymous surface id** is `display-<id-safe nodeId>-<ordinal>`, within the surface id length cap, mirroring
   `blockSurfaceId`. It can never be a `ptah.` id.
9. **Surfaces are published in creation order** with `createdSeq` and `updatedSeq`, so Batch 21 can find the most
   recently created or updated surface (the R1.6 unpinned scroll rule).

## Out-of-scope observations

- Batch 23 must add main-barrel exports for `PTAH_UI_DISPLAY_DOCK_SYNC` and its types, alongside the read port (#59,
  #60).
- Batch 25 must provide the sync token with `useExisting: DisplayDockState`.
