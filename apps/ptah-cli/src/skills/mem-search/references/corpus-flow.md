# Reference — corpus build → prime → query flow

Use a corpus when the same slice of memory will be queried 3+ times in a
session, OR when the slice is large enough that repeated `mem:searchIndex`
calls would cost more tokens than priming once.

## When to build a corpus (vs. plain search)

| Scenario                                        | Pick                            |
| ----------------------------------------------- | ------------------------------- |
| Single recall lookup                            | `mem:searchIndex`               |
| 2-3 lookups against the same filter             | `mem:searchIndex`               |
| Sustained Q&A over a named slice                | `corpus:build` + `corpus:query` |
| Long-running coding session over a feature area | `corpus:build` + `corpus:prime` |

## Build

```ts
interface BuildCorpusParams {
  name: string; // unique per workspace
  workspaceRoot?: string;
  type?: MemoryType[];
  concepts?: string[];
  files?: string[];
  query?: string;
  dateRange?: { fromMs?: number; toMs?: number };
  limit?: number; // default 100 memory ids per corpus
}
```

`corpus:build` runs the persisted filter through `mem:searchIndex` once
and snapshots the resulting memory ids. The filter blob is stored on the
corpus row so subsequent `corpus:rebuild` calls replay the exact same
query.

The store fires a `memory:corpusChanged` push event with
`action: 'built'`.

## Prime

```ts
corpus:prime { name } → { sessionId }
```

Opens a fresh SDK session whose `sessionConfig.corpusName` is set. The
`MemoryPromptInjector` prepends a `## Knowledge corpus: <name>` block
into the system prompt with the memories grouped by type. Token-budget
enforced at `0.9 × budget` (default budget 50000, configurable via
`memory.corpus.primingBudgetTokens`).

The store fires `memory:corpusChanged` with `action: 'primed'`.

## Query

```ts
corpus:query { name, question } → { sessionId, answer: '' }
```

Reuses the most recent alive primed session for the corpus. If none is
alive, auto-primes a fresh one. The `answer` field is empty in the
response — the actual answer streams through the existing chat surface
keyed by `sessionId`.

## Reprime + Rebuild

```ts
corpus:reprime { name } → { sessionId }   // ends all alive primed sessions, then primes fresh
corpus:rebuild { name } → { added, removed } // re-runs the persisted filter, diffs membership
```

Auto-rebuild also fires fire-and-forget after every curator run that
creates new workspace memories, gated by
`memory.corpus.autoRebuildOnExtraction` (default true). You rarely need
to call `corpus:rebuild` manually.

## Delete

```ts
corpus:delete { name } → { deleted: boolean }
```

ON DELETE CASCADE clears the `corpus_memories` join. The store fires
`memory:corpusChanged` with `action: 'deleted'`.

## Privacy invariants

Corpora only carry structured memory summaries (`subject`, `type`, +
the 5-field summary) into the system prompt. `tool_response_text`,
JSONL transcript excerpts, and chunk content NEVER cross the boundary —
the `MemoryPromptInjector` chokepoint is the sole injection route.
