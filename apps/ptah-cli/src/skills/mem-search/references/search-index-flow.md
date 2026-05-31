# Reference — 3-layer search flow

Detailed schemas and worked examples for `mem:searchIndex`, `mem:timeline`,
and `mem:getObservations`. Load on demand from `SKILL.md` — do NOT include
this content in the system prompt by default.

## Layer 1 — `mem:searchIndex`

**Request**

```ts
interface MemSearchIndexParams {
  query?: string;
  workspaceRoot?: string;
  type?: MemoryType[]; // 'discovery' | 'decision' | 'task' | 'preference' | 'fact'
  concepts?: string[]; // matches against the per-concept FTS index
  files?: string[]; // file paths captured at extract time
  dateRange?: { fromMs?: number; toMs?: number };
  topK?: number; // default 20, hard cap 100
}
```

**Response — compact rows only**

```ts
interface MemSearchIndexResult {
  rows: MemoryIndexRow[];
  bm25Only: boolean; // true ⇒ vec index unavailable, ranking is BM25-only
}

interface MemoryIndexRow {
  id: string;
  subject: string | null;
  type: MemoryType;
  concepts: readonly string[];
  files: readonly string[];
  capturedAt: number;
  score: number;
}
```

No `content`, no observation rows, no chunk text. This is the chokepoint
for cheap recall.

**Filter cookbook**

- "What did we decide about X?" — `query: 'X', type: ['decision']`.
- "Everything tied to auth.ts" — `files: ['src/auth.ts'], query: ''`.
- "Recent work on the indexer" — `concepts: ['indexer'], dateRange: { fromMs: <7d ago> }`.
- "Workspace-only listing" — pass `workspaceRoot`; omit `query`.

**Empty-query short-circuit**: when `query` is undefined / empty AND at
least one filter is present, the search engine bypasses BM25 + vec and
returns a pure-filter listing. Cheapest path — prefer it whenever filters
alone are sufficient.

## Layer 2 — `mem:timeline`

```ts
interface MemTimelineParams {
  anchorId: string;
  before?: number; // default 5
  after?: number; // default 5
  workspaceRoot?: string;
}

interface MemTimelineResult {
  rows: MemoryIndexRow[]; // [...before.reverse(), anchor, ...after]
  anchorIndex: number; // = before.length (0 if anchor is at workspace-top)
}
```

Workspace-top / workspace-bottom edge cases simply truncate the window —
`anchorIndex` shrinks to match `before.length` actually returned.

## Layer 3 — `mem:getObservations`

```ts
interface MemGetObservationsParams {
  ids: string[]; // memory ids from Layer 1 or 2
  sessionId?: string; // when present, also returns trailing observation queue rows
  limit?: number; // observation rows per session, default 50
}

interface MemGetObservationsResult {
  memories: MemMemoryFullOut[];
  observations: MemObservationRowOut[];
}
```

`MemMemoryFullOut` includes the full 5-field summary (`request`,
`investigated`, `learned`, `completed`, `nextSteps`) plus the raw
`content` chunk text. `observations` is a read-only peek — invoking this
endpoint does NOT mark rows processed.

## Cost discipline

| Layer | Typical tokens | Use when                      |
| ----- | -------------- | ----------------------------- |
| 1     | 100-400        | First touch, always           |
| 2     | 200-800        | Anchor row is promising       |
| 3     | 1500-6000      | Compact rows are insufficient |

If you find yourself calling Layer 3 with more than ~10 ids, the right
move is usually `corpus:build` instead (see `corpus-flow.md`).
