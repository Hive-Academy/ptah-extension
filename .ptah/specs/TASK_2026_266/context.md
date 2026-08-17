# Context — Memory graph + vector-space explorer

## Why

The memory subsystem is the product's differentiator and it is currently invisible.
`memory-curator-ui` shows a timeline, an entry list, a stats strip, a corpus list and
diagnostics — all of them row-oriented. There is no way to see the _shape_ of what
Ptah has learned about a workspace, and no way to inspect the embedding space that
drives retrieval.

The user asked for this directly: "can we visualize our graph memory to see it?" and
then "a visual application ... and if possible vector db as well".

## What exists today (verified 2026-08-17)

| Layer  | State                                                                                         |
| ------ | --------------------------------------------------------------------------------------------- |
| Schema | **No edges/relations table.** `memories` + `memory_chunks` + FTS5/vec0 only                   |
| RPC    | 15 `memory:*` methods, none is `memory:graph` — `libs/shared/src/lib/types/rpc.types.ts:1466` |
| UI     | No graph or scatter component anywhere in `libs/frontend/memory-curator-ui`                   |

Live counts from `~/.ptah/state/ptah.sqlite`:

- 25,373 memories (24,828 in the `ptah-extension` workspace)
- 25,284 have `concepts_json`, 20,203 have `files_json`, 25,339 have `subject`
- 26,654 embeddings in `memory_chunks_vec`, 384-dim (bge-small-en-v1.5)
- `corpora` / `corpus_memories` are both **empty** — not usable as an edge source
- every memory is tier `recall`; tier is not a useful visual dimension today

## The graph is derived, not stored

There are no edges to read. They have to be built from columns added by
`libs/backend/persistence-sqlite/src/lib/migrations/0017_memory_schema_v2.ts`:

- shared concept (`concepts_json`)
- shared file (`files_json`)
- same `subject`
- same `session_id`

Two node modes both proved useful in the prototype and should both ship:

- **Concepts** — nodes are concept strings sized by frequency, edges are
  co-occurrence within a memory. This is the legible default at 25k scale.
  Top hubs: `electron` (902), `commitlint` (419), `orchestration` (383).
- **Memories** — nodes are individual memories, edges are the shared attributes
  above. Useful when filtered down.

**Hub attributes must be excluded when building memory-mode edges.** A concept shared
by a large slice of the selection connects everything to everything and produces an
unreadable ball. The prototype skipped any concept bucket over ~30 members, file
bucket over ~20, subject bucket over ~25.

**The two modes need different edge-weight thresholds.** Concept co-occurrence counts
run an order of magnitude higher than per-pair memory link weights; a single shared
`minEdge` control produced 574 edges in concept mode and 17 in memory mode.

## Vector projection — PCA is not sufficient

This is the main technical finding and the thing most likely to be re-discovered
expensively.

PCA over the 384-dim embeddings renders a **featureless Gaussian blob**. It is fast
and it is honest, but it shows nothing. A UMAP/LargeVis-style SGD layout — attract
along k-NN edges, repel against randomly sampled non-neighbours — is what separates
clusters.

Measured with a projection-quality metric (share of each point's true 384-dim nearest
neighbours that remain nearest in 2-d, evaluated at a fixed k=10 so scores compare),
on 1,200 points from this workspace:

| Layout                                                 | Score     |
| ------------------------------------------------------ | --------- |
| Local-repulsion force layout                           | 0.123     |
| SGD with negative sampling, gamma=12, k=10, epochs=400 | **0.458** |

Chance is ~0.008. Working parameters: `k=10, epochs=400, negatives=5, gamma=12`,
PCA-seeded, gradients clamped to ±4, learning rate decaying linearly to 0.

Two failure modes were hit and are worth stating so they are not repeated:

1. Springs with no rest length collapse the entire neighbour graph onto a point.
2. Purely local (grid-neighbourhood) repulsion packs points into a uniform lattice
   with no cluster structure. Negative sampling against _random_ nodes is the fix.

**Build the quality metric before tuning the layout.** Two of the three layout
attempts looked plausible in a screenshot and were wrong; the metric caught both.

## Scope

- Graph projection service in `libs/backend/memory-curator` (it owns memory; do not
  start a new lib for this).
- `memory:graph` RPC. The `memory:` prefix is **already** in `ALLOWED_METHOD_PREFIXES`
  at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46`, so only the
  compile-time half of the dual-registration rule is new work — but confirm, because
  a missing runtime guard is a silent crash.
- A vector-layout RPC returning 2-d coordinates plus dictionary-encoded categorical
  columns. The prototype's payload for 3,000 points was ~1.5 MB using parallel arrays
  and a dictionary; naive per-point objects will not scale.
- Graph view + vector view in `libs/frontend/memory-curator-ui` (Electron Memory tab),
  canvas-rendered, `OnPush`, signals.
- Click-through: node → memory detail; vector point → nearest neighbours by cosine.

## Open decisions (resolve during planning)

1. **Where does the layout run?** It is CPU-heavy (~6 s for 3,000 points including
   exact k-NN) and must not block. Options: backend service with a cache, a webview
   worker, or a worker thread in the Electron main process.
2. **Cache or recompute?** A layout cache table keyed by filter hash would make
   revisits instant, at the cost of a migration and invalidation rules.
3. **Sample cap.** Exact k-NN is O(n²·384); the prototype capped the cluster layout at
   6,000 points and rendered all 26k only in PCA mode. Either accept sampling or add
   an approximate-NN index.
4. **Scope of the vector view** — memories only, or also `code_symbols_vec` and
   `skill_candidates_vec`.
5. **VS Code parity.** `memory-curator-ui` is Electron-only today. Decide whether the
   graph ships there too or stays Electron-only.

## Prototype

A working throwaway explorer was built and validated at `tmp/memory-graph/`
(server + single-page client, run with `node tmp/memory-graph/server.mjs`).
It covers both views, the two graph modes, both projections, the tuning endpoint and
the quality metric.

**`tmp/` is gitignored, so the prototype is not durable.** Everything load-bearing
from it is recorded above deliberately. If it still exists when this task starts,
read it first — otherwise the numbers above are the record.

Environment note discovered while building it: the workspace's `better-sqlite3` is
compiled for Electron (NODE_MODULE_VERSION 143) and will not load under plain Node
(137). The prototype used Node's built-in `node:sqlite`. `sqlite-vec` loads fine in
either, because it is a SQLite extension rather than a Node addon — which is also why
no generic SQLite GUI can read the `vec0` tables without explicitly loading
`node_modules/sqlite-vec-windows-x64/vec0.dll`.
