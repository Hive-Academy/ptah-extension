---
name: mem-search
description: Memory recall via 3-layer progressive disclosure (compact index → timeline → full observations) plus a corpus path for long-term knowledge.
tokenEstimate: 2400
triggers:
  - recall
  - what did we
  - previously
  - remember when
  - history of
  - what have we learned
  - prior decisions
---

# mem-search

Use this skill when the user references prior work, past decisions, or any
context that should be recalled rather than re-derived. The Ptah memory
store exposes three search depths with strictly increasing token cost — do
NOT jump to the deepest layer first.

## Layer 1 — index search (cheap)

`mem:searchIndex { query?, type?, concepts?, files?, dateRange?, topK? }`

- Returns COMPACT rows: `id`, `subject`, `type`, `concepts`, `files`,
  `capturedAt`, `score`. No `content` field.
- Empty `query` short-circuits BM25 + vec and runs as a pure-filter listing
  (cheapest possible path).
- Default `topK` is 20. Raise only when you need broader recall.
- `bm25Only: true` on the response means the vec index was unavailable —
  treat the ranking as best-effort.

Start every recall task here. If the compact rows already answer the
question, STOP. Do not escalate to layers 2/3.

## Layer 2 — timeline expansion (mid)

`mem:timeline { anchorId, before?, after? }`

- Returns `[...before.reverse(), anchor, ...after]` with
  `anchorIndex = before.length`.
- Defaults: `before = 5`, `after = 5`.
- Workspace-scoped — never surfaces cross-workspace memories.

Use after Layer 1 when a single anchor row looks promising and you need
its neighbours to reconstruct the surrounding decision.

## Layer 3 — full observations (expensive)

`mem:getObservations { ids: [...] }`

- Returns the full memory rows for the supplied ids INCLUDING the 5-field
  summary (`request`, `investigated`, `learned`, `completed`, `nextSteps`)
  and the trailing observation queue rows tied to that session.
- Token cost scales linearly with `ids.length`. Cap at ~10 ids per call.

Only invoke when the compact rows are insufficient AND the user actually
needs the full content. Most recall tasks finish at Layer 1.

## Corpus path — long-term curated knowledge

For sustained Q&A over a stable slice of memory (e.g. "everything we know
about the auth refactor"), use the corpus flow instead of repeated
searches:

1. `corpus:build { name, type?, concepts?, files?, query?, ... }` —
   snapshot the matching memory ids into a named corpus.
2. `corpus:prime { name }` — open a primed SDK session with the corpus
   pre-loaded into the system prompt.
3. `corpus:query { name, question }` — ask questions against the primed
   session. Reuses the alive session when possible; auto-primes otherwise.

Corpora auto-rebuild after every curator run that creates new workspace
memories (gated by `memory.corpus.autoRebuildOnExtraction`, default true),
so the snapshot stays fresh without manual `corpus:rebuild`.

## Decision rules

1. **Always start at Layer 1.** Layer 2/3 are escalations, not defaults.
2. **Prefer filters over query.** Concept / type / file filters are
   workspace-scoped and cheaper than BM25.
3. **Do NOT scan all memories.** If `topK` would exceed 100, narrow the
   filter first.
4. **Choose corpus over repeated search** when the same slice is queried
   3+ times in a session.

## On-demand references

- `references/search-index-flow.md` — full schema + filter cookbook for
  Layers 1-3.
- `references/corpus-flow.md` — build → prime → query → rebuild lifecycle
  with token budget guidance.
